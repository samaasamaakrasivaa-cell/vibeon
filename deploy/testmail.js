// Тестовое письмо с сервера: node testmail.js адрес (берёт SMTP_* из окружения контейнера VibeOn)
const nodemailer = require("nodemailer");
const to = process.argv[2];
const port = Number(process.env.SMTP_PORT || 587);
const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
t.verify()
  .then(() => { console.log("SMTP: подключение и вход — ok (" + process.env.SMTP_HOST + ":" + port + ")"); return t.sendMail({ from: process.env.MAIL_FROM, to, subject: "VibeOn: тестовое письмо", text: "Почта VibeOn настроена. Это письмо отправлено с сервера vibeon.online.", html: "<p>Почта <b>VibeOn</b> настроена ✅</p><p>Это письмо отправлено с сервера vibeon.online.</p>" }); })
  .then((r) => console.log("Отправлено:", r.messageId, "→", r.accepted.join(", ")))
  .catch((e) => { console.error("Ошибка почты:", e.message); process.exit(1); });
