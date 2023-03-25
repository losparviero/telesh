#!/usr/bin/env node

/*!
 * YouTube Shorts Telegram Bot
 * Copyright (c) 2023
 *
 * @author Zubin
 * @username (GitHub) losparviero
 * @license AGPL-3.0
 */

// Add env vars as a preliminary

require("dotenv").config();
const { Bot, session, InputFile, GrammyError, HttpError } = require("grammy");
const { hydrateReply, parseMode } = require("@grammyjs/parse-mode");
const { run, sequentialize } = require("@grammyjs/runner");
const { hydrate } = require("@grammyjs/hydrate");
const check = require("identify-youtube-shorts");
const Youtube = require("youtube-stream-url");
const getVideoId = require("get-video-id");
const Downloader = require("nodejs-file-downloader");
const fs = require("fs");

// Bot

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
bot.use(admin);
bot.use(hydrate());
bot.use(hydrateReply);

// Parse

bot.api.config.use(parseMode("Markdown"));

// Admin

const admins = process.env.BOT_ADMIN?.split(",").map(Number) || [];
async function admin(ctx, next) {
  ctx.config = {
    botAdmins: admins,
    isAdmin: admins.includes(ctx.chat?.id),
  };
  await next();
}

// Response

async function responseTime(ctx, next) {
  const before = Date.now();
  await next();
  const after = Date.now();
  console.log(`Response time: ${after - before} ms`);
}

// Log

async function log(ctx, next) {
  const from = ctx.from;
  const name =
    from.last_name === undefined
      ? from.first_name
      : `${from.first_name} ${from.last_name}`;
  console.log(
    `From: ${name} (@${from.username}) ID: ${from.id}\nMessage: ${ctx.message.text}`
  );

  const msgText = ctx.message.text;

  if (!msgText.includes("/") && !admins.includes(ctx.chat?.id)) {
    await bot.api.sendMessage(
      process.env.BOT_ADMIN,
      `<b>From: ${ctx.from.first_name} (@${ctx.from.username}) ID: <code>${ctx.from.id}</code></b>`,
      { parse_mode: "HTML" }
    );
    await ctx.api.forwardMessage(
      process.env.BOT_ADMIN,
      ctx.chat.id,
      ctx.message.message_id
    );
  }

  await next();
}

// Commands

bot.command("start", async (ctx) => {
  await ctx
    .reply("*Welcome!* ✨ Send a YouTube shorts link.")
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
  const { id } = getVideoId(ctx.message.text);

  if (!(await check(id))) {
    await ctx.reply("*Send a valid YouTube shorts link.*");
    return;
  }

  const statusMessage = await ctx.reply("*Downloading*");

  const hdurl = await Youtube.getInfo({
    url: ctx.message.text,
  }).then(async (video) => {
    const formatDetails = video.formats.find(
      (format) =>
        format.qualityLabel === "1080p" || format.qualityLabel === "1080p60"
    );

    const formatUrl = formatDetails ? formatDetails.url : null;
    return formatUrl;
  });

  let filename = `${id}.mp4`;

  const downloader = new Downloader({
    url: hdurl,
    directory: "./",
    fileName: filename,
  });

  await downloader.download();

  await ctx.replyWithVideo(new InputFile(`./${filename}`), {
    reply_to_message_id: ctx.message.message_id,
    supports_streaming: true,
  });

  fs.unlink(`./${filename}`);
  await statusMessage.delete();
});

// Messages

bot.on("message:text", async (ctx) => {
  await ctx.reply("*Send a valid YouTube shorts link.*", {
    reply_to_message_id: ctx.message.message_id,
  });
});

// Error

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(
    "Error while handling update",
    ctx.update.update_id,
    "\nQuery:",
    ctx.msg.text
  );
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("Error in request:", e.description);
    if (e.description === "Forbidden: bot was blocked by the user") {
      console.log("Bot was blocked by the user");
    } else {
      ctx.reply("An error occurred");
    }
  } else if (e instanceof HttpError) {
    console.error("Could not contact Telegram:", e);
  } else {
    console.error("Unknown error:", e);
  }
});

// Run

run(bot);
