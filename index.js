const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

// Express setup for Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Tron Lottery Bot is running!'));

// Telegram Bot Setup
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '7576811445:AAFMwQXlhLUCpSzEu-FNTeawdE7hVWZbf0g';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Database for raffle settings and entries
const db = new sqlite3.Database('./lottery.db', (err) => {
  if (err) console.error(err);
  db.run('CREATE TABLE IF NOT EXISTS raffles (chatId TEXT PRIMARY KEY, entryFee REAL DEFAULT 1, hostSplit REAL DEFAULT 40, duration INTEGER DEFAULT 24)');
  db.run('CREATE TABLE IF NOT EXISTS entries (chatId TEXT, telegramId TEXT, amount REAL, FOREIGN KEY(chatId) REFERENCES raffles(chatId))');
});

// Admin Telegram ID (replace with yours later)
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '846800944';

// Commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Welcome to the Tron Lottery SaaS! Hosts use /setup to configure. Players use /enter.');
});

// Host setup command
bot.onText(/\/setup(?:\s+(\d+\.?\d*))?(?:\s+(\d+\.?\d*))?(?:\s+(\d+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const entryFee = match[1] ? parseFloat(match[1]) : 1; // Default 1 USDT
  const hostSplit = match[2] ? parseFloat(match[2]) : 40; // Default 40%
  const duration = match[3] ? parseInt(match[3]) : 24; // Default 24 hours

  if (hostSplit >= 90) return bot.sendMessage(chatId, 'Host split must be less than 90% (admin gets 10%).');

  db.run('INSERT OR REPLACE INTO raffles (chatId, entryFee, hostSplit, duration) VALUES (?, ?, ?, ?)', 
    [chatId, entryFee, hostSplit, duration], (err) => {
      if (err) return bot.sendMessage(chatId, 'Error setting up raffle.');
      bot.sendMessage(chatId, `Raffle set! Entry: ${entryFee} USDT, Host Split: ${hostSplit}%, Duration: ${duration} hours.`);
    });
});

// Player enter command (placeholder for now)
bot.onText(/\/enter/, (msg) => {
  const chatId = msg.chat.id;
  db.get('SELECT * FROM raffles WHERE chatId = ?', [chatId], (err, raffle) => {
    if (!raffle) return bot.sendMessage(chatId, 'Host must run /setup first!');
    bot.sendMessage(chatId, `Send ${raffle.entryFee} USDT to join! (Tron integration coming soon)`);
    db.run('INSERT INTO entries (chatId, telegramId, amount) VALUES (?, ?, 0)', [chatId, msg.from.id]);
  });
});

// Status command
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  db.get('SELECT * FROM raffles WHERE chatId = ?', [chatId], (err, raffle) => {
    if (!raffle) return bot.sendMessage(chatId, 'No raffle set up yet!');
    db.all('SELECT COUNT(*) as participants, SUM(amount) as total FROM entries WHERE chatId = ?', [chatId], (err, rows) => {
      const { participants, total } = rows[0];
      bot.sendMessage(chatId, `Entry: ${raffle.entryFee} USDT | Host Split: ${raffle.hostSplit}% | Duration: ${raffle.duration} hours\nParticipants: ${participants || 0} | Pool: ${total || 0} USDT`);
    });
  });
});

// Start server
app.listen(port, () => {
  console.log(`Bot running on port ${port}`);
});
