const nodemailer = require('nodemailer');
const env = require('../config/env');
const { maskEmail, sanitizeLogText } = require('./privacy');

let transporter = null;
if (env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
}

async function sendMail({ to, subject, html, text }) {
  if (!transporter) {
    console.warn(
      `⚠ SMTP não configurado — mensagem para ${maskEmail(to)} não foi enviada. ` +
      'Configure as variáveis SMTP no ambiente.'
    );
    return { sent: false };
  }

  try {
    await transporter.sendMail({ from: env.MAIL_FROM, to, subject, html, text });
    return { sent: true };
  } catch (err) {
    console.error(
      `❌ Falha ao enviar e-mail para ${maskEmail(to)} ` +
      `(erro ${sanitizeLogText(err?.code || err?.name || 'SMTP_ERROR', 60)}).`
    );
    return { sent: false, error: 'MAIL_DELIVERY_FAILED' };
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sendPasswordResetEmail(toEmail, userName, resetUrl) {
  const subject = 'Redefinição de senha — FinançasPro';
  const safeName = escapeHtml(userName);
  const safeResetUrl = escapeHtml(resetUrl);
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #0f172a;">Redefinição de senha</h2>
      <p>Olá, ${safeName}.</p>
      <p>Recebemos uma solicitação para redefinir a senha da sua conta no FinançasPro. Clique no botão abaixo para criar uma nova senha:</p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="${safeResetUrl}" style="background: #10B981; color: #fff; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600;">
          Redefinir senha
        </a>
      </p>
      <p>Se você não solicitou isso, pode ignorar este e-mail com segurança — sua senha não será alterada.</p>
      <p style="font-size: 12px; color: #64748b;">Este link expira em breve por segurança. Se o botão não funcionar, copie e cole este endereço no navegador:<br>${safeResetUrl}</p>
    </div>
  `;
  const text = `Redefinição de senha — FinançasPro\n\nAcesse o link abaixo para redefinir sua senha:\n${resetUrl}\n\nSe você não solicitou isso, ignore este e-mail.`;

  return sendMail({ to: toEmail, subject, html, text });
}

module.exports = { sendMail, sendPasswordResetEmail };
