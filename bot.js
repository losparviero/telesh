#!/usr/bin/env node

/*!
 * YouTube Shorts Telegram Bot
 * Copyright (c) 2023 to present. All rights reserved.
 *
 * @author Zubin
 * @username (GitHub) losparviero
 * @license AGPL-3.0
 */

// Add env vars as a preliminary

import dotenv from "dotenv";
dotenv.config();
import { Bot, InputFile, session, GrammyError, HttpError } from "grammy";
import { hydrateReply, parseMode } from "@grammyjs/parse-mode";
import { run, sequentialize } from "@grammyjs/runner";
import check from "identify-youtube-shorts";
import ytdl from "@distube/ytdl-core";

// Bot

if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN not set in env.");
}
const bot = new Bot(process.env.BOT_TOKEN);

// Concurrency

function getSessionKey(ctx) {
  return ctx.chat?.id.toString();
}

// Plugins

bot.use(sequentialize(getSessionKey));
bot.use(session({ getSessionKey }));
bot.use(responseTime);
bot.use(log);
bot.use(hydrateReply);

// Config

bot.api.config.use(parseMode("Markdown"));

// Response

async function responseTime(ctx, next) {
  const before = Date.now();
  await next();
  const after = Date.now();
  console.log(`Response time: ${after - before} ms`);
}

// Log

let name;

async function log(ctx, next) {
  const from = ctx.from;
  name =
    (from.first_name !== undefined ? from.first_name : "") +
    (from.last_name !== undefined ? ` ${from.last_name}` : "");
  let message;
  if (ctx.message?.text && !ctx.message.text.startsWith("/")) {
    message = ctx.message.text;
  }
  if (message != undefined) {
    console.log(
      `From: ${name} (@${from.username}) ID: ${from.id}\nMessage: ${message}`
    );
  }
  await next();
}

// Commands

bot.command("start", async (ctx) => {
  await ctx
    .reply(`*Welcome ${name} * ✨\nSend a YouTube shorts link.`)
    .then(console.log("New user added:", ctx.from));
});

bot.command("help", async (ctx) => {
  await ctx
    .reply(
      "*@anzubo Project.*\n\n_This bot downloads YouTube shorts.\nSend a link to try it out!_"
    )
    .then(console.log("Help command sent to", ctx.from.id));
});

// Shorts

bot.on("message::url", async (ctx) => {
  const urlRegex = /(https?:\/\/[^\s]+)/;
  const match = urlRegex.exec(ctx.message.text);
  if (!match) {
    await ctx.reply("*Send a valid YouTube shorts link.*", {
      reply_to_message_id: ctx.message.message_id,
    });
    return;
  }

  const yturl = match[1];
  const id = ytdl.getURLVideoID(yturl);
  if (!(await check(id))) {
    await ctx.reply("*Send a valid YouTube shorts link.*", {
      reply_to_message_id: ctx.message.message_id,
    });
    return;
  }
  await ctx.replyWithChatAction("upload_video");

  try {
    let info = await ytdl.getInfo(id);
    let format = ytdl.chooseFormat(info.formats, {
      quality: "22",
    });
    const video = await fetch(format.url);

    if (video.ok) {
      const buffer = Buffer.from(await video.arrayBuffer());
      const maxFileSize = 50 * 1024 * 1024;
      if (buffer.length <= maxFileSize) {
        await ctx.replyWithChatAction("upload_video");
        await ctx.replyWithVideo(new InputFile(buffer), {
          height: "1920",
          width: "1080",
          supports_streaming: true,
          reply_to_message_id: ctx.message.message_id,
        });
      } else {
        await ctx.reply(
          "*File size too big.*\n_Couldn't be downloaded due to Telegram limits._",
          { reply_to_message_id: ctx.message.message_id }
        );
      }
    } else {
      throw new Error("Error downloading gif.");
    }
  } catch (error) {
    if (error.message.includes("No such format found:")) {
      console.log("Format not found.");
    }
    console.log(error);
    await ctx.reply(`*There was an error.*\n_${error.message}_`, {
      reply_to_message_id: ctx.message.message_id,
    });
  }
});

// Messages

bot.on("message:text", async (ctx) => {
  await ctx.reply("*Send a valid YouTube shorts link.*", {
    reply_to_message_id: ctx.message.message_id,
  });
});

// Error

bot.catch(async (err) => {
  const ctx = err.ctx;
  console.error("Error while handling update", ctx.update.update_id);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("Error in request:", e.description);
    if (e.description === "Forbidden: bot was blocked by the user") {
      console.log("Bot was blocked by the user");
      return;
    }
  } else if (e instanceof HttpError) {
    console.error("Could not contact Telegram:", e);
  } else {
    console.error("Unknown error:", e);
  }
  await ctx.reply("An error occurred");
});

// Run

console.log(`[INIT ${new Date(Date.now()).toLocaleString()}] Bot running.`);
run(bot);
