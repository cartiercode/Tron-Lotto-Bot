const TelegramBot = require('node-telegram-bot-api');
const TronWeb = require('tronweb');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { RedstoneRNG } = require('@redstone-finance/sdk');

// Express setup for Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running!'));

// Telegram Bot Setup
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || 'YOUR_TELEGRAM_TOKEN';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Tron Setup
const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  privateKey: process.env.BOT_PRIVATE_KEY || 'YOUR_BOT_PRIVATE_KEY',
});
const usdtContractAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otS7GYSdiH';
const botAddress = tronWeb.address.fromPrivateKey(process.env.BOT_PRIVATE_KEY || 'YOUR_BOT_PRIVATE_KEY');

// Wallets (use environment variables on Render)
const ADMIN_WALLET = process.env.ADMIN_WALLET || 'YOUR_ADMIN_WALLET';
const HOST_WALLET = process.env.HOST_WALLET || 'YOUR_HOST_WALLET';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || 'YOUR_ADMIN_TELEGRAM_ID';

// SQLite Database
const db = new sqlite3.Database('./lottery.db', (err) => {
  if (err) console.error(err);
  db.run('CREATE TABLE IF NOT EXISTS entries (telegramId TEXT, tronAddress TEXT, amount REAL)');
});

// Entries management
let entries = [];

// Telegram Commands
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Welcome to the Tron USDT Lottery! Use /enter <your_tron_address> to join.');
});

bot.onText(/\/enter (.+)/, (msg, match) => {
  const userWallet = match[1];
  bot.sendMessage(msg.chat.id, `Send 1 USDT to ${botAddress} from ${userWallet} to enter!`);
  db.run('INSERT INTO entries (telegramId, tronAddress, amount) VALUES (?, ?, 0)', [msg.from.id, userWallet]);
});

bot.onText(/\/status/, (msg) => {
  db.all('SELECT SUM(amount) as total, COUNT(*) as participants FROM entries', (err, rows) => {
    if (err) return bot.sendMessage(msg.chat.id, 'Error checking status.');
    const { total, participants } = rows[0];
    bot.sendMessage(msg.chat.id, `Prize Pool: ${total || 0} USDT | Participants: ${participants || 0}`);
  });
});

bot.onText(/\/draw/, async (msg) => {
  if (msg.from.id != ADMIN_TELEGRAM_ID) return bot.sendMessage(msg.chat.id, 'Admin only!');

  // Get entries
  db.all('SELECT * FROM entries', async (err, rows) => {
    if (err || rows.length === 0) return bot.sendMessage(msg.chat.id, 'No entries yet!');
    entries = rows;

    // Redstone RNG (simplified, adjust based on Redstone docs)
    const rng = new RedstoneRNG();
    const randomValue = await rng.getRandomNumber(); // Fetch from Redstone
    const winnerIndex = Math.floor(randomValue % entries.length);
    const winner = entries[winnerIndex];

    // Calculate payouts
    const totalPool = entries.reduce((sum, e) => sum + e.amount, 0);
    const winnerAmount = totalPool * 0.5;
    const hostAmount = totalPool * 0.4;
    const adminAmount = totalPool * 0.1;

    // Send USDT
    const contract = await tronWeb.contract().at(usdtContractAddress);
    await contract.transfer(winner.tronAddress, winnerAmount * 1e6).send();
    await contract.transfer(HOST_WALLET, hostAmount * 1e6).send();
    await contract.transfer(ADMIN_WALLET, adminAmount * 1e6).send();

    bot.sendMessage(msg.chat.id, `Winner: ${winner.telegramId}! Payouts: ${winnerAmount} USDT to winner, ${hostAmount} to host, ${adminAmount} to admin.`);
    db.run('DELETE FROM entries'); // Reset
  });
});

// Monitor USDT Transactions
async function monitorTransactions() {
  const contract = await tronWeb.contract().at(usdtContractAddress);
  contract.Transfer().watch((err, event) => {
    if (err) return console.error(err);
    if (event.to === botAddress) {
      const amount = event.value / 1e6; // USDT has 6 decimals
      db.get('SELECT * FROM entries WHERE tronAddress = ?', [event.from], (err, row) => {
        if (row) {
          db.run('UPDATE entries SET amount = amount + ? WHERE tronAddress = ?', [amount, event.from]);
          bot.sendMessage(row.telegramId, `Entry confirmed: ${amount} USDT received!`);
        }
      });
    }
  });
}

// Start monitoring
monitorTransactions();

// Start Express server for Render
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
