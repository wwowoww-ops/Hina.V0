// ═══════════════════════════════════════════════
//   HINA — MAIN  (نسخة محدّثة)
//   - تسجيل دخول بعدة مكتبات FCA مع انتقال تلقائي
//   - طبقة حماية fcaSafe (إرسال/threadInfo)
//   - مستمع MQTT يدعم (event) و (error, event)
//   - تحميل أوامر تراجعي (recursive) + onLoad + dependencies + envConfig
//   - منع تشغيل handleEvent مرتين لنفس الحدث
// ═══════════════════════════════════════════════

const express = require("express");
const chalk = require("chalk");
const moment = require("moment-timezone");
const { execSync } = require("child_process");
const {
    readdirSync,
    readFileSync,
    writeFileSync,
    existsSync,
    unlinkSync
} = require("fs-extra");
const { join, resolve, basename, relative } = require("path");

// ═══════════════════════════════════════════════
// ERROR HANDLING (مبكراً)
// ═══════════════════════════════════════════════

process.on("unhandledRejection", (error) => {
    console.error(chalk.red("❌ UNHANDLED REJECTION:"), error);
});

process.on("uncaughtException", (error) => {
    console.error(chalk.red("❌ UNCAUGHT EXCEPTION:"), error);
});

// كود الخروج الخاص بأخطاء الإعدادات (الـ launcher لا يعيد التشغيل معه)
const EXIT_CONFIG_ERROR = 78;

// ═══════════════════════════════════════════════
// HEALTH CHECK SERVER
// لا يعمل لو الـ launcher (main.js) شغّال، لأنه يفتح السيرفر بنفسه
// ═══════════════════════════════════════════════

const port = process.env.PORT || 8000;

if (!process.env.HINA_LAUNCHER) {
    const app = express();

    app.get("/", (req, res) => {
        res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>HINA BOT</title>
</head>
<body>
    <h1>HINA BOT</h1>
    <p>Bot is online.</p>
</body>
</html>
        `);
    });

    const server = app.listen(port, () => {
        console.log(chalk.cyan(`📡 Health check server is running on port ${port}`));
    });

    server.on("error", (error) => {
        console.log(chalk.yellow(`[ SERVER ] تعذر تشغيل سيرفر الصحة: ${error.message}`));
    });
}

console.log(
    chalk.bold.hex("#00FA9A")(
        "[ DATA ] » تم الحفاظ على بيانات البوت وعدم حذفها عند التشغيل"
    )
);

// ═══════════════════════════════════════════════
// SYSTEM FILES
// ═══════════════════════════════════════════════

const logger = require("./utils/log.js");

// ═══════════════════════════════════════════════
// FCA LIBRARIES (بالترتيب — لو فشل تسجيل الدخول بواحدة ينتقل للتي بعدها)
// لتغيير الأولوية عدّل هذه المصفوفة فقط
// ═══════════════════════════════════════════════

const FCA_CANDIDATES = [
    "@dongdev/fca-unofficial",
    "mr-juwel-fca",
    "hut-chat-api"
];

const FCA_LIBS = [];

for (const name of FCA_CANDIDATES) {
    try {
        const mod = require(name);
        const fn =
            typeof mod === "function"
                ? mod
                : (mod && (mod.login || mod.default));

        if (typeof fn !== "function") {
            console.log(`[ FCA ] ${name}: لا توجد دالة login`);
            continue;
        }

        let version = "?";
        try {
            version = require(name + "/package.json").version;
        } catch (e) {}

        console.log(`[ FCA AUDIT ] ${name}@${version} جاهزة`);
        FCA_LIBS.push({ name, login: fn });
    } catch (error) {
        console.log(`[ FCA ] تعذر تحميل ${name}: ${error.message}`);
    }
}

if (!FCA_LIBS.length) {
    console.error(chalk.red("❌ [FCA] لا توجد أي مكتبة FCA صالحة. ثبّت واحدة منها: npm i @dongdev/fca-unofficial"));
    process.exit(EXIT_CONFIG_ERROR);
}

function errText(error) {
    if (!error) return "unknown";
    if (typeof error === "string") return error;
    return error.message || error.error || JSON.stringify(error);
}

function login(data, cb) {
    let i = 0;

    const next = (lastErr) => {
        if (i >= FCA_LIBS.length) {
            return cb(lastErr || new Error("فشل تسجيل الدخول بكل المكتبات"));
        }

        const lib = FCA_LIBS[i++];
        console.log(`[ FCA ] تسجيل الدخول عبر ${lib.name}`);

        let ok = false;
        let failed = false;

        try {
            lib.login(JSON.parse(JSON.stringify(data)), (err, api) => {
                if (ok) return cb(err, api);

                if (err) {
                    if (failed) return;
                    failed = true;
                    console.log(`[ FCA ] فشل ${lib.name}: ${errText(err)}`);
                    return next(err);
                }

                ok = true;
                global.fcaName = lib.name;
                cb(null, api);
            });
        } catch (error) {
            if (!failed) {
                failed = true;
                console.log(`[ FCA ] استثناء في ${lib.name}: ${errText(error)}`);
                next(error);
            }
        }
    };

    next();
}

// ═══════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════

console.log(
    chalk.bold.hex("#03f0fc")("[ HINA ] » ") +
    chalk.bold.hex("#fcba03")("Initializing variables...")
);

function freshLoadStats() {
    return {
        commandsLoaded: 0,
        commandsFailed: 0,
        eventsLoaded: 0,
        eventsFailed: 0,
        totalCommandFiles: 0,
        totalEventFiles: 0,
        failedCommands: [],
        failedEvents: []
    };
}

global.client = new Object({
    commands: new Map(),
    events: new Map(),
    cooldowns: new Map(),
    eventRegistered: new Array(),
    handleSchedule: new Array(),
    handleReaction: new Array(),
    handleReply: new Array(),
    mainPath: process.cwd(),
    configPath: new String(),
    loadStats: freshLoadStats()
});

global.data = new Object({
    threadInfo: new Map(),
    threadData: new Map(),
    userName: new Map(),
    userBanned: new Map(),
    threadBanned: new Map(),
    commandBanned: new Map(),
    threadAllowNSFW: new Array(),
    allUserID: new Array(),
    allCurrenciesID: new Array(),
    allThreadID: new Array()
});

global.utils = require("./utils/index.js");
global.utils.config = require("./utils/config.js");
global.utils.decorations = require("./utils/decorations.js");

global.nodemodule = new Object();
global.config = new Object();
global.configModule = new Object();
global.moduleData = new Array();
global.language = new Object();

// ═══════════════════════════════════════════════
// تحميل الإعدادات
// ═══════════════════════════════════════════════

let configValue;

try {
    global.client.configPath = join(global.client.mainPath, "config.json");
    configValue = require(global.client.configPath);
    logger.loader("Found file config: config.json");
} catch (error) {
    logger.loader("config.json not found!", "error");
    process.exit(EXIT_CONFIG_ERROR);
}

try {
    for (const key in configValue) {
        global.config[key] = configValue[key];
    }
    logger.loader("Config Loaded!");
} catch (error) {
    logger.loader("Can't load file config!", "error");
    process.exit(EXIT_CONFIG_ERROR);
}

// ═══════════════════════════════════════════════
// DATABASE
// ═══════════════════════════════════════════════

let Sequelize;
let sequelize;
let database;

try {
    database = require("./includes/database/index.js");
    Sequelize = database?.Sequelize;
    sequelize = database?.sequelize;

    if (sequelize && typeof sequelize.authenticate === "function") {
        console.log(chalk.green("✅ Sequelize module loaded successfully."));
    } else {
        console.log(
            chalk.yellow(
                "⚠️ Sequelize غير متاح حالياً — سيتم تشغيل البوت بدون قاعدة البيانات."
            )
        );
    }
} catch (error) {
    console.log(chalk.red("❌ فشل تحميل نظام قاعدة البيانات:"));
    console.log(error);
}

try {
    writeFileSync(
        global.client.configPath + ".temp",
        JSON.stringify(global.config, null, 4),
        "utf8"
    );
} catch (error) {}

// ═══════════════════════════════════════════════
// تحميل اللغة
// ═══════════════════════════════════════════════

try {
    const languagePath = `${__dirname}/languages/${global.config.language || "en"}.lang`;

    const langFile = readFileSync(languagePath, { encoding: "utf-8" }).split(/\r?\n|\r/);

    const langData = langFile.filter(
        (item) => item.indexOf("#") !== 0 && item !== ""
    );

    for (const item of langData) {
        const getSeparator = item.indexOf("=");
        if (getSeparator === -1) continue;

        const itemKey = item.slice(0, getSeparator);
        const itemValue = item.slice(getSeparator + 1);

        const dotIndex = itemKey.indexOf(".");
        if (dotIndex === -1) continue;

        const head = itemKey.slice(0, dotIndex);
        const key = itemKey.replace(head + ".", "");
        const value = itemValue.replace(/\\n/gi, "\n");

        if (typeof global.language[head] === "undefined") {
            global.language[head] = new Object();
        }

        global.language[head][key] = value;
    }
} catch (error) {
    console.log("Language Load Error: " + error.message);
}

global.getText = function (...args) {
    try {
        const langText = global.language;
        let text = langText[args[0]][args[1]];

        if (!text) return `[${args[1]}]`;

        for (let i = args.length - 1; i > 0; i--) {
            const regEx = RegExp(`%${i}`, "g");
            text = text.replace(regEx, args[i + 1]);
        }

        return text;
    } catch (error) {
        return `[${args[1]}]`;
    }
};

// ═══════════════════════════════════════════════
// APPSTATE
// ═══════════════════════════════════════════════

const appStateFile = resolve(
    join(global.client.mainPath, global.config.APPSTATEPATH || "appstate.json")
);

let appState;

if (process.env.APPSTATE) {
    try {
        appState = JSON.parse(process.env.APPSTATE);
        logger.loader("💌 ───『 تم العثور على APPSTATE في إعدادات السيرفر 』─── 💌");
    } catch (error) {
        logger.loader("خطأ في تنسيق JSON الخاص بـ APPSTATE!", "error");
        process.exit(EXIT_CONFIG_ERROR);
    }
} else {
    try {
        appState = require(appStateFile);
        logger.loader("💌 ───『 تم العثور على ملف appstate.json محلياً 』─── 💌");
    } catch (error) {
        logger.loader(
            "لم يتم العثور على ملف تسجيل الدخول أو متغير البيئة APPSTATE!",
            "error"
        );
        process.exit(EXIT_CONFIG_ERROR);
    }
}

// ═══════════════════════════════════════════════
// HELPERS (حزم / إعدادات الأوامر / منع التكرار)
// ═══════════════════════════════════════════════

function installPackage(name, version) {
    const spec =
        version == "*" || version == "" || version == undefined
            ? name
            : `${name}@${version}`;

    execSync(`npm install --no-package-lock --save ${spec}`, {
        stdio: "inherit",
        env: process.env,
        shell: true,
        cwd: global.client.mainPath
    });
}

// يتأكد من وجود الحزم المطلوبة في config.dependencies (ولا يوقف تحميل الأمر لو فشل)
function ensureDependencies(deps, ownerName) {
    for (const dep of Object.keys(deps)) {
        if (global.nodemodule[dep]) continue;

        try {
            global.nodemodule[dep] = require(dep);
            continue;
        } catch (e) {}

        try {
            global.nodemodule[dep] = require(
                join(global.client.mainPath, "nodemodules", "node_modules", dep)
            );
            continue;
        } catch (e) {}

        logger.loader(`الحزمة ${dep} غير موجودة (${ownerName}) — جاري التثبيت...`, "warn");

        try {
            installPackage(dep, deps[dep]);
            global.nodemodule[dep] = require(dep);
        } catch (error) {
            logger.loader(
                `تعذر تثبيت ${dep} للأمر ${ownerName}: ${errText(error)}`,
                "warn"
            );
        }
    }
}

function applyEnvConfig(mod) {
    const name = mod.config.name;
    const env = mod.config.envConfig;

    if (!env || typeof env !== "object") return;

    if (typeof global.configModule[name] === "undefined") global.configModule[name] = {};
    if (typeof global.config[name] === "undefined") global.config[name] = {};

    for (const key in env) {
        if (typeof global.config[name][key] !== "undefined") {
            global.configModule[name][key] = global.config[name][key];
        } else {
            global.configModule[name][key] = env[key] || "";
            global.config[name][key] = env[key] || "";
        }
    }
}

// onLoad يُستدعى مرة واحدة فقط لكل ملف (حتى لا تتكرر المؤقتات بعد إعادة الاتصال)
const ONLOAD_DONE = new WeakSet();

function runOnLoad(mod, label, api, botModel) {
    if (typeof mod.onLoad !== "function" || ONLOAD_DONE.has(mod)) return;
    ONLOAD_DONE.add(mod);

    try {
        const result = mod.onLoad({ api, models: botModel });
        if (result && typeof result.catch === "function") {
            result.catch((error) =>
                logger.loader(`فشل onLoad في ${label}: ${errText(error)}`, "warn")
            );
        }
    } catch (error) {
        logger.loader(`فشل onLoad في ${label}: ${errText(error)}`, "warn");
    }
}

// يمنع تشغيل handleEvent لنفس الحدث مرتين
// (handleCommandEvent و handleEvent كلاهما يمر على نفس الـ events)
function guardOnce(key, mod) {
    if (typeof mod.handleEvent !== "function" || mod.handleEvent.__once) return;

    const original = mod.handleEvent;

    const wrapped = function (obj) {
        const ev = obj && obj.event;

        if (ev && typeof ev === "object") {
            if (!ev.__ran) {
                Object.defineProperty(ev, "__ran", {
                    value: new Set(),
                    enumerable: false
                });
            }

            if (ev.__ran.has(key)) return;
            ev.__ran.add(key);
        }

        return original.apply(this, arguments);
    };

    wrapped.__once = true;

    try {
        mod.handleEvent = wrapped;
    } catch (error) {}
}

function getAllFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = join(dir, entry.name);
        return entry.isDirectory() ? getAllFiles(fullPath) : [fullPath];
    });
}

// ═══════════════════════════════════════════════
// تحميل الأوامر
// ═══════════════════════════════════════════════

function loadCommands(api, botModel) {
    const stats = global.client.loadStats;
    const commandsPath = join(global.client.mainPath, "script", "commands");

    if (!existsSync(commandsPath)) {
        console.error(chalk.red("[ COMMANDS ] مجلد الأوامر غير موجود: " + commandsPath));
        return;
    }

    const disabled = Array.isArray(global.config.commandDisabled)
        ? global.config.commandDisabled
        : [];

    const isDisabled = (file) => {
        const base = basename(file);
        return disabled.some((d) => d === base || d + ".js" === base);
    };

    let files = [];

    try {
        files = getAllFiles(commandsPath).filter(
            (file) =>
                file.endsWith(".js") &&
                !basename(file).includes("example") &&
                !isDisabled(file)
        );
    } catch (error) {
        console.error(chalk.red("[ COMMANDS ] فشل قراءة مجلد الأوامر: " + error.message));
        return;
    }

    stats.totalCommandFiles = files.length;

    for (const file of files) {
        const shortName = relative(commandsPath, file);

        try {
            const mod = require(file);

            if (
                !mod ||
                !mod.config ||
                !mod.config.name ||
                typeof mod.run !== "function"
            ) {
                throw new Error("ملف الأمر لا يحتوي config.name أو run");
            }

            const name = mod.config.name;

            if (global.client.commands.has(name)) {
                logger.loader(`⚠️ اسم أمر مكرر: ${name} (${shortName}) — سيتم الاستبدال`, "warn");
            }

            if (mod.config.dependencies && typeof mod.config.dependencies === "object") {
                ensureDependencies(mod.config.dependencies, name);
            }

            applyEnvConfig(mod);
            runOnLoad(mod, name, api, botModel);

            if (typeof mod.handleEvent === "function") {
                guardOnce("cmd:" + name, mod);
                global.client.events.set(name, mod);
                console.log(`[EVENT COMMAND] تم تسجيل ${name} كـ Event`);
            }

            global.client.commands.set(name, mod);
            stats.commandsLoaded++;

            logger.loader(`🌸『 تـم تحميل: ${name} 』🌸`);
        } catch (error) {
            stats.commandsFailed++;
            stats.failedCommands.push({
                file: shortName,
                reason: error?.message || String(error)
            });

            logger.loader(`Fail load command: ${shortName}`, "error");
            console.log(error);
        }
    }
}

// ═══════════════════════════════════════════════
// تحميل الأحداث
// ═══════════════════════════════════════════════

function loadEvents(api, botModel) {
    const stats = global.client.loadStats;
    const eventsPath = join(global.client.mainPath, "script", "events");

    if (!existsSync(eventsPath)) return;

    let events = [];

    try {
        events = readdirSync(eventsPath).filter((ev) => ev.endsWith(".js"));
    } catch (error) {
        console.log(chalk.red("[ EVENTS ] فشل قراءة الأحداث: " + error.message));
        return;
    }

    stats.totalEventFiles = events.length;

    for (const ev of events) {
        try {
            const event = require(join(eventsPath, ev));

            if (
                !event ||
                !event.config ||
                !event.config.name ||
                typeof event.handleEvent !== "function"
            ) {
                throw new Error("ملف الحدث لا يحتوي config.name أو handleEvent");
            }

            const name = event.config.name;

            if (event.config.dependencies && typeof event.config.dependencies === "object") {
                ensureDependencies(event.config.dependencies, name);
            }

            applyEnvConfig(event);
            runOnLoad(event, name, api, botModel);

            guardOnce("evt:" + name, event);
            global.client.events.set(name, event);
            stats.eventsLoaded++;

            logger.loader(`⚡『 تـم تحميل الحدث: ${name} 』⚡`);
        } catch (error) {
            stats.eventsFailed++;
            stats.failedEvents.push({
                file: ev,
                reason: error?.message || String(error)
            });

            logger.loader(`Fail load event: ${ev}`, "error");
            console.log(error);
        }
    }
}

// ═══════════════════════════════════════════════
// AUTO RECONNECT SYSTEM
// ═══════════════════════════════════════════════

let reconnectAttempts = 0;

const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 5000;
const MAX_RECONNECT_DELAY = 60000;

let isConnecting = false;
let reconnectTimer = null;
let connectionGeneration = 0;
let activeApi = null;
let activeStop = null;
let isConnected = false;

function getReconnectDelay() {
    const delay =
        INITIAL_RECONNECT_DELAY * Math.pow(2, Math.max(reconnectAttempts - 1, 0));
    return Math.min(delay, MAX_RECONNECT_DELAY);
}

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function closeOldConnection() {
    try {
        if (typeof activeStop === "function") {
            activeStop();
        }
    } catch (error) {}

    activeStop = null;

    if (!activeApi) return;

    try {
        if (typeof activeApi.stopListening === "function") {
            activeApi.stopListening();
        } else if (typeof activeApi.stopListenMqtt === "function") {
            activeApi.stopListenMqtt();
        }
    } catch (error) {
        console.log(
            chalk.gray("[ MQTT ] لا يمكن إيقاف الاتصال القديم: " + error.message)
        );
    }

    activeApi = null;
    isConnected = false;
}

function scheduleReconnect(botModel) {
    if (reconnectTimer) {
        console.log(chalk.gray("[ MQTT ] توجد بالفعل محاولة إعادة اتصال مجدولة."));
        return;
    }

    reconnectAttempts++;

    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        console.log(
            chalk.red(
                `❌ تم الوصول إلى الحد الأقصى لمحاولات إعادة الاتصال (${MAX_RECONNECT_ATTEMPTS}).`
            )
        );
        return;
    }

    const delay = getReconnectDelay();

    console.log(
        chalk.yellow(
            `⏳ إعادة الاتصال بعد ${delay / 1000} ثوانٍ — المحاولة ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`
        )
    );

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        onBot({ models: botModel });
    }, delay);
}

// ═══════════════════════════════════════════════
// LOGIN / BOT
// ═══════════════════════════════════════════════

// أنواع أحداث لا تهم البوت (تتجاهل كلها)
const IGNORED_TYPES = [
    "presence",
    "typ",
    "read_receipt",
    "read",
    "delivery",
    "ready",
    "status",
    "thread_update"
];

function onBot({ models: botModel }) {
    if (isConnecting) {
        console.log(chalk.gray("[ MQTT ] توجد محاولة اتصال قيد التنفيذ بالفعل."));
        return;
    }

    isConnecting = true;
    clearReconnectTimer();
    connectionGeneration++;

    const currentGeneration = connectionGeneration;

    closeOldConnection();

    const loginData = { appState };

    console.log(chalk.cyan(`🔌 محاولة الاتصال بـ Facebook... [${currentGeneration}]`));

    login(loginData, async (loginError, loginApiData) => {
        isConnecting = false;

        if (currentGeneration !== connectionGeneration) {
            console.log(chalk.gray("[ MQTT ] تم تجاهل نتيجة اتصال قديم."));
            return;
        }

        // ═══════════════════════════════════
        // LOGIN ERROR
        // ═══════════════════════════════════

        if (loginError) {
            isConnected = false;

            console.error(
                chalk.red(`❌ خطأ في تسجيل الدخول: ${errText(loginError)}`)
            );

            scheduleReconnect(botModel);
            return;
        }

        // ═══════════════════════════════════
        // LOGIN SUCCESS
        // ═══════════════════════════════════

        reconnectAttempts = 0;
        clearReconnectTimer();

        activeApi = loginApiData;
        isConnected = true;

        console.log(chalk.green(`✅ تم تسجيل الدخول بنجاح! (${global.fcaName || "FCA"})`));

        // ═══════════════════════════════════
        // OPTIONS (أي قيمة في config.json > FCAOption تتغلّب على الافتراضي)
        // ═══════════════════════════════════

        const fcaOptions = Object.assign(
            {
                listenEvents: true,
                selfListen: false,
                autoMarkRead: false,
                autoMarkDelivery: false,
                autoReconnect: true,
                logLevel: "warn"
            },
            global.config.FCAOption || {}
        );

        console.log("[ FCA ] الخيارات المستخدمة =", JSON.stringify(fcaOptions));

        try {
            if (typeof loginApiData.setOptions === "function") {
                loginApiData.setOptions(fcaOptions);
            }
        } catch (error) {
            console.log(chalk.yellow("[ HINA ] فشل تطبيق FCAOption: " + error.message));
        }

        // ═══════════════════════════════════
        // حفظ APPSTATE
        // ═══════════════════════════════════

        try {
            writeFileSync(
                appStateFile,
                JSON.stringify(loginApiData.getAppState(), null, "\t")
            );
        } catch (error) {
            console.log(chalk.gray("[ APPSTATE ] " + error.message));
        }

        // ═══════════════════════════════════
        // طبقة الحماية (إرسال مقاوم للفشل + حفظ appstate دوري)
        // threadInfoFallback:false لأن handleCommand يعالج null بنفسه،
        // ولا نريد تخزين معلومات محادثة فاضية في الكاش
        // ═══════════════════════════════════

        try {
            require("./includes/fcaSafe.js")(loginApiData, {
                appStateFile,
                threadInfoFallback: false
            });
        } catch (error) {
            console.error(chalk.red("❌ [ FCA SAFE ]"), error && error.stack ? error.stack : error);
        }

        global.config.version = "1.2.14";
        global.client.timeStart = new Date().getTime();

        // ═══════════════════════════════════
        // تصفير الإحصائيات والخرائط
        // ═══════════════════════════════════

        global.client.loadStats = freshLoadStats();
        global.client.commands.clear();
        global.client.events.clear();

        // ═══════════════════════════════════
        // تحميل الأوامر والأحداث
        // ═══════════════════════════════════

        loadCommands(loginApiData, botModel);
        loadEvents(loginApiData, botModel);

        // ═══════════════════════════════════
        // LOAD SUMMARY
        // ═══════════════════════════════════

        const stats = global.client.loadStats;
        const totalLoaded = stats.commandsLoaded + stats.eventsLoaded;
        const totalFailed = stats.commandsFailed + stats.eventsFailed;
        const totalFiles = stats.totalCommandFiles + stats.totalEventFiles;

        logger.loader("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        logger.loader("🌸 HINA LOADER");
        logger.loader(`الأوامر المحملة: ${stats.commandsLoaded}`);
        logger.loader(`الأحداث المحملة: ${stats.eventsLoaded}`);
        logger.loader(`الأوامر الفاشلة: ${stats.commandsFailed}`);
        logger.loader(`الأحداث الفاشلة: ${stats.eventsFailed}`);
        logger.loader(`إجمالي المحمل: ${totalLoaded}`);
        logger.loader(`إجمالي الفاشل: ${totalFailed}`);
        logger.loader(`إجمالي الملفات: ${totalFiles}`);
        logger.loader("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        // ═══════════════════════════════════
        // حذف ملف config المؤقت
        // ═══════════════════════════════════

        if (existsSync(global.client.configPath + ".temp")) {
            try {
                unlinkSync(global.client.configPath + ".temp");
            } catch (error) {}
        }

        // ═══════════════════════════════════
        // LISTENER
        // ═══════════════════════════════════

        let listener;

        try {
            listener = require("./includes/listen.js")({
                api: loginApiData,
                models: botModel
            });
        } catch (error) {
            console.error(chalk.red("❌ فشل تحميل listen.js:"), error);
            isConnected = false;
            scheduleReconnect(botModel);
            return;
        }

        // ═══════════════════════════════════
        // MQTT LISTENER
        // المكتبة قد تستدعي callback بالشكل (event) أو (error, event) — ندعم الاثنين
        // ═══════════════════════════════════

        let eventCount = 0;

        const onMqtt = async (a, b) => {
            if (currentGeneration !== connectionGeneration) return;

            let error = null;
            let message;

            if (
                b === undefined &&
                a &&
                typeof a === "object" &&
                !(a instanceof Error) &&
                a.type
            ) {
                message = a;
            } else {
                error = a;
                message = b;
            }

            // ─── خطأ اتصال ───
            if (error) {
                isConnected = false;

                console.log(chalk.red(`⚠️ قطع اتصال MQTT: ${errText(error)}`));

                if (activeApi !== loginApiData) return;

                activeApi = null;

                try {
                    if (typeof activeStop === "function") {
                        activeStop();
                    } else if (typeof loginApiData.stopListening === "function") {
                        loginApiData.stopListening();
                    } else if (typeof loginApiData.stopListenMqtt === "function") {
                        loginApiData.stopListenMqtt();
                    }
                } catch (closeError) {}

                activeStop = null;

                console.log(chalk.yellow("🔄 سيتم إعادة الاتصال بشكل منظم..."));
                scheduleReconnect(botModel);
                return;
            }

            if (!message) return;

            if (eventCount++ === 0) {
                console.log(`[ LISTEN ] ✅ وصل أول حدث (type=${message.type})`);
            }

            if (IGNORED_TYPES.includes(message.type)) return;

            if (message.type === "error") {
                console.error(
                    chalk.red("❌ [LISTEN ERROR EVENT]"),
                    errText(message.error || message)
                );
                return;
            }

            try {
                return await listener(message);
            } catch (listenerError) {
                console.error(chalk.red("❌ LISTENER ERROR:"), listenerError);
            }
        };

        try {
            const listenFn = loginApiData.listenMqtt || loginApiData.listen;

            if (typeof listenFn !== "function") {
                throw new Error(
                    "لا توجد دالة listen/listenMqtt. الدوال المتاحة: " +
                        Object.keys(loginApiData).join(", ")
                );
            }

            const stopFn = listenFn.call(loginApiData, onMqtt);
            activeStop = typeof stopFn === "function" ? stopFn : null;
        } catch (mqttError) {
            isConnected = false;

            console.error(chalk.red("❌ فشل تشغيل MQTT:"), mqttError);

            activeApi = null;
            scheduleReconnect(botModel);
            return;
        }

        setTimeout(() => {
            if (currentGeneration === connectionGeneration && eventCount === 0) {
                console.warn(
                    "[ LISTEN ] ⚠️ لم يصل أي حدث خلال دقيقتين. راجع الـ appstate و FCAOption وتأكد أن الحساب يستقبل رسائل."
                );
            }
        }, 120000);

        // ═══════════════════════════════════
        // API
        // ═══════════════════════════════════

        global.client.api = loginApiData;

        logger("HINA ✨", "[ by ayman ]");

        // ═══════════════════════════════════
        // رسالة تشغيل البوت (بتأخير عشوائي)
        // لا يوجد تغيير بايو دوري: نمط آلي يزيد احتمال تسجيل الخروج
        // ═══════════════════════════════════

        const adminID = (global.config.ADMINBOT || [])[0];

        if (adminID) {
            setTimeout(() => {
                if (currentGeneration !== connectionGeneration) return;

                try {
                    const timeNow = moment().tz("Africa/Casablanca").format("HH:mm:ss");
                    loginApiData.sendMessage(
                        `لـقـد تـم تـشـغـيـل الـبـوت فـي ${timeNow} ✅`,
                        adminID
                    );
                } catch (error) {
                    console.log(chalk.gray("[ ADMIN MESSAGE ] " + error.message));
                }
            }, 20000 + Math.floor(Math.random() * 15000));
        }

        console.log(chalk.green("🟢 HINA MQTT connection is active."));
    });
}

// ═══════════════════════════════════════════════
// START BOT
// ═══════════════════════════════════════════════

(async () => {
    let models = null;

    // محاولة الاتصال بقاعدة البيانات (فشلها لا يمنع تشغيل البوت)
    if (sequelize && typeof sequelize.authenticate === "function") {
        try {
            await sequelize.authenticate();
            console.log(chalk.green("✅ Database connection established."));
        } catch (error) {
            console.log(chalk.yellow("⚠️ Database connection failed."));
            console.log(chalk.gray(error?.message || error));
            console.log(
                chalk.yellow("⚠️ سيتم تشغيل البوت وتحميل الأوامر رغم فشل قاعدة البيانات.")
            );
        }
    } else {
        console.log(chalk.yellow("⚠️ Database غير متاحة — سيتم تشغيل البوت بدونها."));
    }

    // تحميل Models
    try {
        if (Sequelize && sequelize) {
            models = require("./includes/database/model.js")({
                Sequelize,
                sequelize
            });

            console.log(chalk.green("✅ Database models loaded."));
        } else {
            console.log(
                chalk.yellow("⚠️ تم تخطي تحميل Database Models لأن Sequelize غير متاح.")
            );
        }
    } catch (error) {
        console.log(chalk.yellow("⚠️ فشل تحميل Database Models:"));
        console.log(error);
        models = null;
    }

    // تشغيل البوت مهما كانت حالة قاعدة البيانات
    try {
        onBot({ models });
    } catch (error) {
        console.log(chalk.red("❌ فشل بدء البوت:"));
        console.log(error);
    }

    console.log(
        chalk.bold.hex("#eff1f0")(
            "════════════════ SUCCESFULLY ═════════════════"
        )
    );
})();