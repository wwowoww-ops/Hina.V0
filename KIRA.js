const { spawn } = require("child_process");
const logger = require("./utils/log");
const express = require("express");
const gradient = require("gradient-string");

const logo = `
██╗  ██╗ ██╗ ██████╗   ██╗  
██║ ██╔╝ ██║ ██╔══██╗ ███║  
█████╔╝  ██║ ██████╔╝ ╚██║  
██╔═██╗  ██║ ██╔══██╗  ██║  
██║  ██╗ ██║ ██║  ██║  ██║  
╚═╝  ╚═╝ ╚═╝ ╚═╝  ╚═╝  ╚═╝  
`;

const c = ["cyan", "#7D053F"];
const redToGreen = gradient("red", "cyan");

console.log(redToGreen("━".repeat(50), { interpolation: "hsv" }));
console.log(gradient(c).multiline(logo));
console.log(redToGreen("━".repeat(50), { interpolation: "hsv" }));

// ═══════════════════════════════════════════════
// سيرفر الصحة (الـ launcher هو المسؤول عنه، و index.js لا يفتح سيرفراً عند تشغيله من هنا)
// ═══════════════════════════════════════════════

const app = express();
const port = process.env.PORT || 3078;

app.get("/", (req, res) => {
    res.send("Hello im KIRA Bot..🤖");
});

// ═══════════════════════════════════════════════
// إعادة التشغيل
// ═══════════════════════════════════════════════

const EXIT_CONFIG_ERROR = 78;          // خطأ إعدادات: لا فائدة من إعادة التشغيل
const MAX_RESTARTS = 10;               // أقصى عدد إعادة تشغيل متتالية
const STABLE_AFTER_MS = 5 * 60 * 1000; // لو اشتغل أكثر من هذا نصفّر العدّاد

let restarts = 0;
let startedAt = 0;
let child = null;
let shuttingDown = false;

function startBot(message) {
    if (message) logger(message, "[ Starting ]");

    startedAt = Date.now();

    child = spawn(
        process.execPath,
        ["--trace-warnings", "--async-stack-traces", "index.js"],
        {
            cwd: __dirname,
            stdio: "inherit",
            env: { ...process.env, HINA_LAUNCHER: "1" }
        }
    );

    child.on("close", (code) => {
        if (shuttingDown) return;

        if (code === 0) {
            logger("البوت أنهى عمله بشكل طبيعي.", "[ Starting ]");
            return;
        }

        if (code === EXIT_CONFIG_ERROR) {
            logger(
                "خطأ في الإعدادات (config / appstate / مكتبة FCA) — لن تتم إعادة التشغيل تلقائياً.",
                "[ Starting ]"
            );
            return;
        }

        if (Date.now() - startedAt > STABLE_AFTER_MS) restarts = 0;

        restarts++;

        if (restarts > MAX_RESTARTS) {
            logger(
                `تم تجاوز الحد الأقصى لإعادة التشغيل (${MAX_RESTARTS}). راجع الأخطاء أعلاه.`,
                "[ Starting ]"
            );
            return;
        }

        const delay = Math.min(30000, 3000 * restarts);

        logger(
            `خرج البوت بالكود ${code} — إعادة التشغيل بعد ${delay / 1000} ثوانٍ (${restarts}/${MAX_RESTARTS})`,
            "[ Starting ]"
        );

        setTimeout(() => startBot("Starting up..."), delay);
    });

    child.on("error", (error) => {
        logger("An error occurred: " + JSON.stringify(error), "[ Starting ]");
    });
}

function shutdown(signal) {
    shuttingDown = true;

    try {
        if (child) child.kill(signal);
    } catch (e) {}

    setTimeout(() => process.exit(0), 1000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

logger("KIRA BOT", "[ NAME ]");
logger("Version: 1.2.14", "[ VERSION ]");

startBot();

const server = app.listen(port, () => {
    console.log(`bot running in port: ${port}`);
});

server.on("error", (error) => {
    console.log(`[ SERVER ] تعذر تشغيل سيرفر الصحة على المنفذ ${port}: ${error.message}`);
});