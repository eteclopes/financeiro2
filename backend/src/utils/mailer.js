const nodemailer = require('nodemailer');
const env = require('../config/env');

// Transporte é criado uma única vez e reaproveitado entre requisições.
// Se SMTP_HOST não estiver configurado, `transporter` fica null e
// `sendMail` apenas loga um aviso — o app continua funcionando (útil em
// desenvolvimento ou enquanto o provedor de e-mail não foi configurado),
// mas em produção o e-mail simplesmente não é enviado até isso ser feito.
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
      `⚠ SMTP não configurado (SMTP_HOST ausente) — e-mail para ${to} com assunto "${subject}" não foi enviado. ` +
        'Configure SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS no .env para habilitar envio real.'
    );
    return { sent: false };
  }

  try {
    await transporter.sendMail({ from: env.MAIL_FROM, to, subject, html, text });
    return { sent: true };
  } catch (err) {
    // Falha no envio de e-mail nunca deve derrubar o fluxo principal
    // (ex: usuário ainda deve poder solicitar reset mesmo se o provedor
    // de e-mail estiver fora do ar) — só logamos o erro.
    console.error(`❌ Falha ao enviar e-mail para ${to}:`, err.message);
    return { sent: false, error: err.message };
  }
}

function sendPasswordResetEmail(toEmail, userName, resetUrl) {
  const subject = 'Redefinição de senha — FinançasPro';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #0f172a;">Redefinição de senha</h2>
      <p>Olá, ${userName ?? ''}.</p>
      <p>Recebemos uma solicitação para redefinir a senha da sua conta no FinançasPro. Clique no botão abaixo para criar uma nova senha:</p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="${resetUrl}" style="background: #10B981; color: #fff; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600;">
          Redefinir senha
        </a>
      </p>
      <p>Se você não solicitou isso, pode ignorar este e-mail com segurança — sua senha não será alterada.</p>
      <p style="font-size: 12px; color: #64748b;">Este link expira em breve por segurança. Se o botão não funcionar, copie e cole este endereço no navegador:<br>${resetUrl}</p>
    </div>
  `;
  const text = `Redefinição de senha — FinançasPro\n\nAcesse o link abaixo para redefinir sua senha:\n${resetUrl}\n\nSe você não solicitou isso, ignore este e-mail.`;

  return sendMail({ to: toEmail, subject, html, text });
}

module.exports = { sendMail, sendPasswordResetEmail };
