/**
 * TelegramService — uploads files to a Telegram chat and returns stable file refs.
 *
 * Separated from the route so:
 *   - the route stays thin (middleware + controller)
 *   - this service is easily testable / swappable (e.g. for S3 later)
 *   - failure here never breaks the patient record save (errors are caught per file)
 */

const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');

function buildEndpoint(uploadMode) {
  return uploadMode === 'document' ? 'sendDocument' : 'sendPhoto';
}
function buildFieldName(uploadMode) {
  return uploadMode === 'document' ? 'document' : 'photo';
}

function uploadFiles({ files, botToken, chatId, uploadMode = 'photo', caption }) {
  const endpoint = buildEndpoint(uploadMode);
  const fieldName = buildFieldName(uploadMode);
  const attachments = [];

  for (const file of files) {
    try {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append(fieldName, file.buffer, { filename: file.originalname });
      form.append('caption', caption);

      const res = axios.postSync
        ? axios.postSync(`https://api.telegram.org/bot${botToken}/${endpoint}`, form, {
            headers: form.getHeaders(),
          })
        : null;

      // axios is async — handle properly below in uploadFilesAsync
      void res;
    } catch (err) {
      logger.error('telegramService', `Upload failed for ${file.originalname}: ${err.message}`);
    }
  }
  return attachments;
}

// Proper async implementation (used by patientService)
async function uploadFilesAsync({ files, botToken, chatId, uploadMode = 'photo', caption }) {
  const endpoint = buildEndpoint(uploadMode);
  const fieldName = buildFieldName(uploadMode);
  const attachments = [];

  for (const file of files) {
    try {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append(fieldName, file.buffer, { filename: file.originalname });
      form.append('caption', caption);

      const telegramRes = await axios.post(`https://api.telegram.org/bot${botToken}/${endpoint}`, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      if (telegramRes.data?.ok) {
        attachments.push({
          telegram_message_id: telegramRes.data.result.message_id,
          telegram_file_id: telegramRes.data.result[fieldName]?.file_id,
          type: fieldName,
          filename: file.originalname,
        });
      }
    } catch (err) {
      logger.error(
        'telegramService',
        `Upload failed for ${file.originalname}: ${err.response?.data?.description || err.message}`
      );
      // continue to next file — never block the record from being saved
    }
  }
  return attachments;
}

// Overwrite the sync stub with the async real impl so callers using the function
// get the async version transparently. patientService awaits uploadFiles().
module.exports = { uploadFiles: uploadFilesAsync, testTelegram, sendAlertMessage };

async function testTelegram({ token, chat_id }) {
  const res = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id,
    text: '✅ MediCare bot connection successful.',
  });
  return res.data;
}

/**
 * Send a TEXT notification message to a Telegram chat (used for the alerts group).
 * Reads the bot token from the settings table (so callers don't need to pass it).
 * Never throws — alert delivery must not break the main request flow.
 *
 * @param {object} settingsRepo — the settings repository (to read bot token + alerts chat id)
 * @param {string} text — the message text (can include Markdown/emoji)
 * @returns {Promise<boolean>} true if sent successfully
 */
async function sendAlertMessage(settingsRepo, text) {
  try {
    const botToken = settingsRepo.get('telegram_bot_token');
    const alertsChatId = settingsRepo.get('telegram_alerts_chat_id');
    if (!botToken || !alertsChatId) {
      logger.warn('telegramService', 'Alert not sent: telegram_bot_token or telegram_alerts_chat_id not configured.');
      return false;
    }
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: alertsChatId,
      text,
      parse_mode: 'Markdown',
    }, { timeout: 8000 });
    return true;
  } catch (err) {
    logger.warn('telegramService', `Alert send failed: ${err.response?.data?.description || err.message}`);
    return false;
  }
}
