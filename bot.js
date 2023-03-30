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
const ytdl = require("ytdl-core");
const util = require("util");
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
  let message = ctx.message?.text || ctx.channelPost?.text || undefined;
  const from = ctx.from || ctx.chat;
  const name =
    `${from.first_name || ""} ${from.last_name || ""}`.trim() || ctx.chat.title;

  // Console

  console.log(
    `From: ${name} (@${from.username}) ID: ${from.id}\nMessage: ${message}`
  );

  // Channel

  if (
    ctx.message &&
    !ctx.message?.text?.includes("/") &&
    process.env.LOG_CHANNEL
  ) {
    await bot.api.sendMessage(
      process.env.LOG_CHANNEL,
      `<b>From: ${name} (@${from.username}) ID: <code>${from.id}</code></b>`,
      { parse_mode: "HTML" }
    );

    await ctx.api.forwardMessage(
      process.env.LOG_CHANNEL,
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
  const id = ytdl.getURLVideoID(ctx.message.text);

  if (!(await check(id))) {
    await ctx.reply("*Send a valid YouTube shorts link.*");
    return;
  }

  const statusMessage = await ctx.reply("*Downloading*");

  let filename = `${id}.mp4`;

  async function download(url) {
    return new Promise((resolve, reject) => {
      const videoStream = ytdl(url);
      const writeStream = fs.createWriteStream(filename);

      videoStream.on("error", (error) => {
        reject(error);
      });

      writeStream.on("close", () => {
        resolve();
      });

      videoStream.pipe(writeStream);
    });
  }

  await download(ctx.message.text)
    .then(async () => {
      console.log(`Video ID: ${filename} downloaded successfully.`);

      const stat = util.promisify(fs.stat);
      const unlink = util.promisify(fs.unlink);

      const stats = await stat(filename);
      const fileSizeInBytes = stats.size;
      const size = fileSizeInBytes / (1024 * 1024);

      if (size < 50) {
        await ctx.replyWithVideo(new InputFile(filename), {
          reply_to_message_id: ctx.message.message_id,
          supports_streaming: true,
        });
      } else {
        await ctx.reply("*Video is over 50MB.*", {
          reply_to_message_id: ctx.message.message_id,
        });
      }

      await unlink(`./${filename}`);
    })
    .catch((error) => {
      console.log(error);
    });

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
