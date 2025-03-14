console.log('Starting bot...');
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const TronWeb = require('tronweb');

console.log('Dependencies loaded.');

// Express setup
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Tron Lottery Bot is running!'));
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// Telegram Bot Setup
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
console.log('Initializing Telegram bot...');
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
console.log('Telegram bot initialized.');

// Tron Setup (Nile Testnet)
const tronWeb = new TronWeb({
  fullHost: 'https://nile.trongrid.io',
  privateKey: process.env.BOT_PRIVATE_KEY,
});
const usdtContractAddress = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
let botAddress;
try {
  botAddress = tronWeb.address.fromPrivateKey(process.env.BOT_PRIVATE_KEY);
  console.log(`Bot address initialized: ${botAddress}`);
} catch (error) {
  console.error('Failed to initialize bot address:', error.message);
}

// Environment Variables
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const ADMIN_WALLET = process.env.ADMIN_WALLET || botAddress;
const ENTRY_FEE = 1;

// Database
console.log('Setting up database...');
const db = new sqlite3.Database('./lottery.db', (err) => {
  if (err) {
    console.error('SQLite Error:', err.message);
  } else {
    db.run('CREATE TABLE IF NOT EXISTS raffles (chatId TEXT PRIMARY KEY, entryFee REAL DEFAULT 1, hostSplit REAL DEFAULT 40, duration INTEGER DEFAULT 24, hostWallet TEXT, startTime INTEGER)');
    db.run('CREATE TABLE IF NOT EXISTS entries (chatId TEXT, telegramId TEXT, tronAddress TEXT, amount REAL, FOREIGN KEY(chatId) REFERENCES raffles(chatId))');
    console.log('Database tables created.');
  }
});

// Commands
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Welcome to the Tron Lottery SaaS! Hosts use /setup. Players use /enter <tron_address>.');
});

bot.onText(/\/setup(?:\s+(\d+\.?\d*))?(?:\s+(\d+\.?\d*))?(?:\s+(\d+))?(?:\s+([T][a-zA-Z0-9]{33}))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const entryFee = match[1] ? parseFloat(match[1]) : ENTRY_FEE;
  const hostSplit = match[2] ? parseFloat(match[2]) : 40;
  const duration = match[3] ? parseInt(match[3]) : 24;
  const hostWallet = match[4] || botAddress;
  const startTime = Math.floor(Date.now() / 1000);

  if (hostSplit >= 90) return bot.sendMessage(chatId, 'Host split must be less than 90% (admin gets 10%).');

  db.run('INSERT OR REPLACE INTO raffles (chatId, entryFee, hostSplit, duration, hostWallet, startTime) VALUES (?, ?, ?, ?, ?, ?)', 
    [chatId, entryFee, hostSplit, duration, hostWallet, startTime], (err) => {
      if (err) return bot.sendMessage(chatId, 'Error setting up raffle.');
      bot.sendMessage(chatId, `Raffle set! Entry: ${entryFee} USDT, Host Split: ${hostSplit}%, Duration: ${duration} hours, Host Wallet: ${hostWallet}`);
    });
});

bot.onText(/\/enter (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const tronAddress = match[1];
  db.get('SELECT * FROM raffles WHERE chatId = ?', [chatId], (err, raffle) => {
    if (!raffle) return bot.sendMessage(chatId, 'Host must run /setup first!');
    bot.sendMessage(chatId, `Send ${raffle.entryFee} USDT to ${botAddress} from ${tronAddress} to enter!`);
    db.run('INSERT INTO entries (chatId, telegramId, tronAddress, amount) VALUES (?, ?, ?, 0)', [chatId, msg.from.id, tronAddress]);
  });
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  db.get('SELECT * FROM raffles WHERE chatId = ?', [chatId], (err, raffle) => {
    if (!raffle) return bot.sendMessage(chatId, 'No raffle set up yet!');
    db.all('SELECT COUNT(*) as participants, SUM(amount) as total FROM entries WHERE chatId = ?', [chatId], (err, rows) => {
      const { participants, total } = rows[0];
      const timeLeft = raffle.duration * 3600 - (Math.floor(Date.now() / 1000) - raffle.startTime);
      bot.sendMessage(chatId, `Entry: ${raffle.entryFee} USDT | Host Split: ${raffle.hostSplit}% | Duration: ${raffle.duration} hours\nParticipants: ${participants || 0} | Pool: ${total || 0} USDT | Time Left: ${Math.max(0, Math.floor(timeLeft / 3600))} hours`);
    });
  });
});

// Monitor Transactions
async function monitorTransactions() {
  try {
    console.log('Starting transaction monitoring...');
    const contract = await tronWeb.contract().at(usdtContractAddress);
    console.log('Contract initialized, polling for transfers...');
    setInterval(async () => {
      try {
        const events = await contract.Transfer().get({ fromBlock: 'latest' });
        events.forEach(event => {
          console.log('Transfer event:', event);
          if (event.to === botAddress) {
            const amount = event.value / 1e6;
            console.log(`Detected ${amount} USDT from ${event.from} to ${botAddress}`);
            db.get('SELECT * FROM entries WHERE tronAddress = ?', [event.from], (err, entry) => {
              if (err) console.error('Database query error:', err);
              if (entry) {
                db.run('UPDATE entries SET amount = amount + ? WHERE tronAddress = ?', [amount, event.from], (err) => {
                  if (err) console.error('Database update error:', err);
                  else bot.sendMessage(entry.chatId, `${entry.telegramId} sent ${amount} USDT! Entry confirmed.`);
                });
              }
            });
          }
        });
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 30000);
  } catch (error) {
    console.error('Failed to initialize contract:', error.message);
  }
}

monitorTransactions();
console.log('Bot startup complete.');
