/**
 * سجن_الجروب.js
 * اختيار مجموعات متعددة وتغيير أسمائها وحذف كنيات أعضائها
 * جميع التقارير تُرسل إلى مجموعة تنفيذ الأمر فقط.
 */

module.exports.config = {
    name: "سجن_الجروب",
    version: "2.0.0",
    hasPermssion: 2,
    credits: "أبو هريرة",
    description: "تغيير أسماء المجموعات وحذف كنيات الأعضاء",
    commandCategory: "Developer",
    usages: "سجن_الجروب",
    cooldowns: 30
};

const GROUP_NAME = "شلة السجن قاهرتكم ⛓️🔒";
const BATCH_DELAY = 500;
const MAX_RETRIES = 3;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function getDeveloperIDs() {
    const admins = global.config?.ADMINBOT;
    const devs = global.KIRA_CONF?.dev;

    return [
        ...(Array.isArray(admins) ? admins : admins ? [admins] : []),
        ...(Array.isArray(devs) ? devs : devs ? [devs] : [])
    ].map(String);
}

function callAPI(api, methodName, args = [], timeout = 15000) {
    return new Promise((resolve, reject) => {
        const method = api[methodName];

        if (typeof method !== "function") {
            return reject(new Error(`الدالة ${methodName} غير متاحة`));
        }

        let finished = false;

        const timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            reject(new Error(`انتهت مهلة ${methodName}`));
        }, timeout);

        const callback = (error, result) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);

            if (error) return reject(error);
            resolve(result);
        };

        try {
            const result = method.call(api, ...args, callback);

            // دعم الدوال التي تعيد Promise
            if (result && typeof result.then === "function") {
                result.then(
                    value => callback(null, value),
                    error => callback(error)
                );
            }
        } catch (error) {
            callback(error);
        }
    });
}

function sendToControl(api, controlThreadID, message, messageID) {
    return new Promise(resolve => {
        api.sendMessage(message, controlThreadID, () => resolve(), messageID);
    });
}

async function getThreads(api) {
    return callAPI(api, "getThreadList", [100, null, ["INBOX"]]);
}

async function getThreadInfo(api, threadID) {
    return callAPI(api, "getThreadInfo", [threadID]);
}

function isGroupThread(thread) {
    if (!thread || !thread.threadID) return false;
    if (thread.isGroup === true) return true;
    if (thread.isGroup === false) return false;

    return Number(thread.participantIDs?.length || 0) > 2;
}

function getNickname(info, userID) {
    const nicknames = info?.nicknames;

    if (!nicknames) return undefined;

    if (Array.isArray(nicknames)) {
        const item = nicknames.find(
            entry => String(entry.userID || entry.id) === String(userID)
        );
        return item?.nickname;
    }

    return nicknames[String(userID)];
}

async function setGroupTitle(api, threadID) {
    await callAPI(api, "setTitle", [GROUP_NAME, threadID]);

    // التحقق من الاسم بعد التغيير
    const info = await getThreadInfo(api, threadID);

    if (info?.threadName && info.threadName !== GROUP_NAME) {
        throw new Error("لم يتأكد تغيير اسم المجموعة");
    }
}

async function deleteNickname(api, threadID, userID) {
    // في واجهات FCA المعتادة، تمرير سلسلة فارغة يطلب إزالة الكنية.
    await callAPI(api, "changeNickname", ["", threadID, userID]);
}

async function removeGroupImage(api, threadID) {
    // لا نستخدم changeGroupImage بصورة فارغة أو بقيمة مجهولة.
    // نستخدم فقط دالة حذف صريحة إن كانت المكتبة توفرها.
    const candidates = [
        "removeGroupImage",
        "deleteGroupImage",
        "removeThreadImage",
        "deleteThreadImage"
    ];

    const method = candidates.find(name => typeof api[name] === "function");

    if (!method) {
        return {
            success: false,
            reason: "مكتبة البوت لا توفر دالة حذف صريحة معروفة لصورة المجموعة"
        };
    }

    try {
        await callAPI(api, method, [threadID]);
        return { success: true };
    } catch (error) {
        return { success: false, reason: error.message };
    }
}

async function processGroup(api, threadID) {
    const report = {
        threadID,
        title: false,
        image: false,
        imageReason: "",
        nicknameSuccess: 0,
        nicknameSkipped: 0,
        nicknameFailed: 0,
        members: 0
    };

    try {
        await setGroupTitle(api, threadID);
        report.title = true;
    } catch (error) {
        console.error("[سجن_الجروب] تغيير الاسم:", threadID, error);
    }

    const imageResult = await removeGroupImage(api, threadID);
    report.image = imageResult.success;
    report.imageReason = imageResult.reason || "";

    let info;

    try {
        info = await getThreadInfo(api, threadID);
    } catch (error) {
        console.error("[سجن_الجروب] جلب الأعضاء:", threadID, error);
        return report;
    }

    const members = [...new Set(
        (info.participantIDs || []).map(String)
    )];

    report.members = members.length;

    // نعيد المحاولة للأعضاء الذين فشل معهم الحذف فقط.
    let pending = [];

    for (const userID of members) {
        const nickname = getNickname(info, userID);

        if (nickname === "") {
            report.nicknameSkipped++;
        } else {
            pending.push(userID);
        }
    }

    for (let attempt = 1; attempt <= MAX_RETRIES && pending.length; attempt++) {
        const failedThisRound = [];

        for (const userID of pending) {
            try {
                await deleteNickname(api, threadID, userID);
                report.nicknameSuccess++;
            } catch (error) {
                failedThisRound.push(userID);
                console.error(
                    `[سجن_الجروب] حذف الكنية - المحاولة ${attempt}:`,
                    threadID,
                    userID,
                    error
                );
            }

            await sleep(BATCH_DELAY);
        }

        pending = failedThisRound;

        if (pending.length && attempt < MAX_RETRIES) {
            await sleep(1000);
        }
    }

    report.nicknameFailed = pending.length;

    return report;
}

module.exports.run = async function ({ api, event }) {
    const { threadID, senderID, messageID } = event;

    if (!getDeveloperIDs().includes(String(senderID))) {
        return api.sendMessage("هذا الأمر للمطور فقط.", threadID, messageID);
    }

    try {
        const threads = await getThreads(api);

        const groups = (threads || [])
            .filter(isGroupThread)
            .filter(thread => String(thread.threadID) !== String(threadID));

        if (!groups.length) {
            return sendToControl(
                api,
                threadID,
                "لم أجد مجموعات أخرى متاحة في قائمة المحادثات.",
                messageID
            );
        }

        const shownGroups = groups.slice(0, 50);

        const list = shownGroups.map((group, index) => {
            const title = group.name || group.threadName || "مجموعة بلا اسم";
            return `${index + 1}. ${title}`;
        }).join("\n");

        const sent = await new Promise(resolve => {
            api.sendMessage(
                "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\n" +
                "أرسل أرقام المجموعات التي تريد سجنها، مفصولة بمسافات أو فواصل.\n" +
                "مثال: 1 3 5\n\n" +
                list +
                "\n\nأرسل «إلغاء» للتوقف.",
                threadID,
                (error, info) => resolve(info),
                messageID
            );
        });

        if (!sent?.messageID) {
            return;
        }

        if (!global.client.handleReply) {
            global.client.handleReply = [];
        }

        global.client.handleReply.push({
            name: module.exports.config.name,
            messageID: sent.messageID,
            author: String(senderID),
            controlThreadID: String(threadID),
            groups: shownGroups.map(group => ({
                threadID: String(group.threadID),
                name: group.name || group.threadName || "مجموعة بلا اسم"
            }))
        });
    } catch (error) {
        console.error("[سجن_الجروب]", error);

        return sendToControl(
            api,
            threadID,
            "تعذر عرض المجموعات. تحقق من صلاحيات البوت وواجهة API.",
            messageID
        );
    }
};

module.exports.handleReply = async function ({ api, event, handleReply }) {
    const { threadID, senderID, body, messageID } = event;

    if (String(senderID) !== handleReply.author) return;
    if (String(threadID) !== handleReply.controlThreadID) return;

    const removeSession = () => {
        const sessions = global.client.handleReply || [];
        const index = sessions.findIndex(
            item => item.messageID === handleReply.messageID &&
                    item.name === module.exports.config.name
        );

        if (index !== -1) sessions.splice(index, 1);
    };

    if (String(body || "").trim().toLowerCase() === "إلغاء") {
        removeSession();
        return sendToControl(api, threadID, "تم إلغاء العملية.", messageID);
    }

    const numbers = String(body || "")
        .split(/[\s,،]+/)
        .filter(Boolean)
        .map(Number);

    if (
        !numbers.length ||
        numbers.some(number =>
            !Number.isInteger(number) ||
            number < 1 ||
            number > handleReply.groups.length
        )
    ) {
        return sendToControl(
            api,
            threadID,
            "الأرقام غير صحيحة. أرسل أرقام المجموعات مفصولة بمسافات أو فواصل، أو أرسل «إلغاء».",
            messageID
        );
    }

    removeSession();

    const selected = [...new Set(numbers)].map(
        number => handleReply.groups[number - 1]
    );

    await sendToControl(
        api,
        threadID,
        `بدأت العملية على ${selected.length} مجموعة. ستظهر النتائج هنا فقط.`,
        messageID
    );

    const results = [];

    for (const group of selected) {
        const report = await processGroup(api, group.threadID);
        results.push({ group, report });
    }

    const output = results.map(({ group, report }) =>
        `المجموعة: ${group.name}\n` +
        `تغيير الاسم: ${report.title ? "نجح" : "فشل أو لم يُتحقق منه"}\n` +
        `حذف الصورة: ${
            report.image
                ? "نجح"
                : "لم يتم — " + (report.imageReason || "تعذر التحقق")
        }\n` +
        `حُذفت الكنيات: ${report.nicknameSuccess}\n` +
        `تجاوز كنيات فارغة: ${report.nicknameSkipped}\n` +
        `فشل حذف الكنيات بعد المحاولات: ${report.nicknameFailed}\n` +
        `عدد الأعضاء: ${report.members}`
    ).join("\n\n──────────\n\n");

    return sendToControl(
        api,
        threadID,
        "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\nانتهت العملية\n\n" + output,
        messageID
    );
};