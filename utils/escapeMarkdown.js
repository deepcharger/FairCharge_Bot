// utils/escapeMarkdown.js
function escapeMarkdownV2(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

module.exports = { escapeMarkdownV2 };
