import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  isLidUser,
  isPnUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from 'baileys';
import qrcode from 'qrcode-terminal';
import { config } from './config.js';
import { phoneFromJid } from './identity/phone.js';
import { logger } from './logger.js';
import { handleMessage, parseTrigger } from './router.js';

const log = logger.child({ module: 'whatsapp' });
const baileysLogger = logger.child({ module: 'baileys' }, { level: 'warn' });

function messageText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.ephemeralMessage?.message?.extendedTextMessage?.text ||
    message.ephemeralMessage?.message?.conversation ||
    ''
  );
}

/**
 * Phone number of whoever sent the message, as E.164.
 * Baileys v7 may address users by LID (xxx@lid) instead of phone; the *Alt fields or the
 * LID mapping store give us the phone number back.
 */
async function senderPhone(sock, key) {
  const group = isJidGroup(key.remoteJid);
  const candidates = group ? [key.participant, key.participantAlt] : [key.remoteJid, key.remoteJidAlt];

  const pn = candidates.find((j) => isPnUser(j));
  if (pn) return phoneFromJid(pn);

  const lid = candidates.find((j) => isLidUser(j));
  if (lid) {
    const mapped = await sock.signalRepository.lidMapping.getPNForLID(lid).catch(() => null);
    if (mapped) return phoneFromJid(mapped);
  }
  return null;
}

async function onMessage(sock, msg) {
  const { key } = msg;
  const chatJid = key.remoteJid;
  if (!chatJid || key.fromMe || chatJid === 'status@broadcast' || chatJid.endsWith('@newsletter')) return;

  const text = messageText(msg.message);
  if (!text) return;

  if (parseTrigger(text) === null) return;

  const isGroup = Boolean(isJidGroup(chatJid));
  if (isGroup && config.whatsapp.allowedGroups.length && !config.whatsapp.allowedGroups.includes(chatJid)) {
    log.info({ chatJid }, 'trigger in a group not in ALLOWED_GROUPS (add this JID to enable)');
    return;
  }

  await sock.sendPresenceUpdate('composing', chatJid).catch(() => {});
  const phone = await senderPhone(sock, key);
  const reply = await handleMessage({ chatJid, isGroup, senderPhone: phone, text });
  if (!reply) return;

  await sock.sendPresenceUpdate('paused', chatJid).catch(() => {});
  await sock.sendMessage(chatJid, { text: reply }, { quoted: msg });
}

export async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
    logger: baileysLogger,
    browser: Browsers.ubuntu('WTT Bot'),
    // Keep the phone receiving notifications; don't pull old chats into the bot.
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      log.info('Scan this QR code with the bot phone: WhatsApp > Linked devices > Link a device');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') log.info({ me: sock.user?.id }, 'WhatsApp connected');
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log.error(`Logged out from WhatsApp. Delete ${config.whatsapp.authDir} and restart to link again.`);
        process.exit(1);
      }
      log.warn({ code }, 'connection closed, reconnecting in 3s');
      setTimeout(() => startWhatsApp().catch((err) => log.error({ err }, 'reconnect failed')), 3000);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    // Not awaited: a slow answer in one chat must not hold up the others.
    for (const msg of messages) {
      onMessage(sock, msg).catch((err) => log.error({ err }, 'message handling failed'));
    }
  });

  return sock;
}
