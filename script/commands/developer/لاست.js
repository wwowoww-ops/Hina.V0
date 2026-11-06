
const fs = require("fs");
const path = require("path");

module.exports.config = {
    name: "لاست",
    version: "5.2.0",
    hasPermssion: 2,
    credits: "أبو هريرة",
    description: "عرض المجموعات وإدارتها وتنظيف المحادثات القديمة",
    commandCategory: "developer",
    usages: "لاست",
    cooldowns: 5
};

// ==================================================
// الإعدادات
// ==================================================

const DEV_ID = "61594221091809";

const DATA_DIR = path.join(__dirname, "../../../data");
const BANNED_FILE = path.join(DATA_DIR, "banned.json");
const LEFT_THREADS_FILE = path.join(DATA_DIR, "leftThreads.json");

// ==================================================
// الملفات
// ==================================================

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function ensureJsonFile(file, defaultValue = {}) {
    ensureDataDir();

    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(defaultValue, null, 2)
        );
    }
}

// ==================================================
// الحظر
// ==================================================

function getBanned() {
    ensureJsonFile(BANNED_FILE, {});

    try {
        const data = JSON.parse(
            fs.readFileSync(BANNED_FILE, "utf8")
        );

        return data && typeof data === "object" && !Array.isArray(data)
            ? data
            : {};
    } catch {
        return {};
    }
}

function saveBanned(data) {
    ensureDataDir();

    fs.writeFileSync(
        BANNED_FILE,
        JSON.stringify(data, null, 2)
    );
}

// ==================================================
// المجموعات التي خرج منها البوت
// ==================================================

function getLeftThreads() {
    ensureJsonFile(LEFT_THREADS_FILE, {});

    try {
        const data = JSON.parse(
            fs.readFileSync(LEFT_THREADS_FILE, "utf8")
        );

        return data && typeof data === "object" && !Array.isArray(data)
            ? data
            : {};
    } catch {
        return {};
    }
}

function saveLeftThread(threadID, info = {}) {
    const leftThreads = getLeftThreads();
    const id = String(threadID);

    leftThreads[id] = {
        threadID: id,
        threadName:
            info.threadName ||
            leftThreads[id]?.threadName ||
            `مجموعة ${id}`,
        leftAt:
            leftThreads[id]?.leftAt ||
            new Date().toISOString()
    };

    ensureDataDir();

    fs.writeFileSync(
        LEFT_THREADS_FILE,
        JSON.stringify(leftThreads, null, 2)
    );
}

function removeLeftThread(threadID) {
    const leftThreads = getLeftThreads();

    delete leftThreads[String(threadID)];

    fs.writeFileSync(
        LEFT_THREADS_FILE,
        JSON.stringify(leftThreads, null, 2)
    );
}

// ==================================================
// جمع معرفات المجموعات
// ==================================================

function addThreadIDs(ids, data) {
    if (!data) return;

    // المصفوفات
    if (Array.isArray(data)) {
        for (const item of data) {
            if (
                typeof item === "string" ||
                typeof item === "number"
            ) {
                ids.add(String(item));
            } else if (item && typeof item === "object") {
                const id = item.threadID || item.threadId;

                if (id) {
                    ids.add(String(id));
                }
            }
        }

        return;
    }

    // الكائنات
    if (typeof data === "object") {
        for (const key of Object.keys(data)) {
            if (key) {
                ids.add(String(key));
            }
        }
    }
}

// ==================================================
// قراءة المجموعات من Messenger API
// ==================================================

function getThreadListIDs(api) {
    return new Promise(resolve => {
        if (
            !api ||
            typeof api.getThreadList !== "function"
        ) {
            return resolve([]);
        }

        let finished = false;

        const finish = result => {
            if (finished) return;

            finished = true;
            resolve(result);
        };

        try {
            api.getThreadList(
                100,
                null,
                ["INBOX"],
                (error, list) => {
                    if (
                        error ||
                        !Array.isArray(list)
                    ) {
                        return finish([]);
                    }

                    const ids = [];

                    for (const thread of list) {
                        if (!thread) continue;

                        const isGroup =
                            thread.isGroup === true ||
                            thread.threadType === "GROUP";

                        if (!isGroup) continue;

                        const id =
                            thread.threadID ||
                            thread.threadId;

                        if (id) {
                            ids.push(String(id));
                        }
                    }

                    finish(ids);
                }
            );

            setTimeout(() => {
                finish([]);
            }, 10000);

        } catch {
            finish([]);
        }
    });
}

// ==================================================
// جمع المجموعات من جميع المصادر
// ==================================================

async function collectThreadIDs(api, Threads) {
    const ids = new Set();

    // global.data.allThreadID
    try {
        addThreadIDs(
            ids,
            global.data?.allThreadID
        );
    } catch {}

    // global.data.threadData
    try {
        addThreadIDs(
            ids,
            global.data?.threadData
        );
    } catch {}

    // global.data.threadInfo
    try {
        addThreadIDs(
            ids,
            global.data?.threadInfo
        );
    } catch {}

    // Threads.database
    try {
        addThreadIDs(
            ids,
            Threads?.database
        );
    } catch {}

    // Threads.getAll
    try {
        if (typeof Threads?.getAll === "function") {
            const result = await Threads.getAll();

            addThreadIDs(ids, result);
        }
    } catch {}

    // Messenger API
    try {
        const apiIDs = await getThreadListIDs(api);

        for (const id of apiIDs) {
            ids.add(String(id));
        }
    } catch {}

    return ids;
}

// ==================================================
// معلومات المجموعة
// ==================================================

function getRealThreadInfo(api, threadID) {
    return new Promise(resolve => {
        if (
            !api ||
            typeof api.getThreadInfo !== "function"
        ) {
            return resolve(null);
        }

        try {
            api.getThreadInfo(
                String(threadID),
                (error, info) => {
                    if (error || !info) {
                        return resolve(null);
                    }

                    resolve(info);
                }
            );
        } catch {
            resolve(null);
        }
    });
}

function getGroupName(info, threadID) {
    if (!info) {
        return `مجموعة ${threadID}`;
    }

    return (
        info.threadName ||
        info.name ||
        `مجموعة ${threadID}`
    );
}

function getMemberCount(info) {
    if (!info) return 0;

    if (Array.isArray(info.participantIDs)) {
        return info.participantIDs.length;
    }

    if (Array.isArray(info.participants)) {
        return info.participants.length;
    }

    return (
        info.memberCount ||
        info.participantCount ||
        0
    );
}

// ==================================================
// اختبار الاتصال بالمجموعة
// ==================================================

function testGroupByMessage(api, threadID) {
    return new Promise(resolve => {
        if (
            !api ||
            typeof api.sendMessage !== "function"
        ) {
            return resolve({
                success: false,
                error: "api.sendMessage غير متوفرة"
            });
        }

        const testMessage =
            "اختبار اتصال البوت بالمجموعة";

        let finished = false;

        const finish = result => {
            if (finished) return;

            finished = true;
            resolve(result);
        };

        try {
            api.sendMessage(
                testMessage,
                String(threadID),
                error => {
                    if (error) {
                        return finish({
                            success: false,
                            error:
                                error.message ||
                                String(error)
                        });
                    }

                    finish({
                        success: true
                    });
                }
            );

            setTimeout(() => {
                finish({
                    success: false,
                    error: "لم تستجب API"
                });
            }, 7000);

        } catch (error) {
            finish({
                success: false,
                error:
                    error.message ||
                    String(error)
            });
        }
    });
}

// ==================================================
// حذف المحادثة
// ==================================================

function deleteThread(api, threadID) {
    return new Promise(resolve => {
        if (
            !api ||
            typeof api.deleteThread !== "function"
        ) {
            return resolve({
                success: false,
                error: "api.deleteThread غير متوفرة في API"
            });
        }

        let finished = false;

        const finish = result => {
            if (finished) return;

            finished = true;
            resolve(result);
        };

        try {
            api.deleteThread(
                String(threadID),
                error => {
                    if (error) {
                        return finish({
                            success: false,
                            error:
                                error.message ||
                                String(error)
                        });
                    }

                    finish({
                        success: true
                    });
                }
            );

            setTimeout(() => {
                finish({
                    success: false,
                    error: "لم تستجب API عند حذف المحادثة"
                });
            }, 7000);

        } catch (error) {
            finish({
                success: false,
                error:
                    error.message ||
                    String(error)
            });
        }
    });
}

// ==================================================
// حذف المجموعة من المصادر المعروفة
// ==================================================

function removeFromKnownThreads(threadID) {
    const id = String(threadID);

    try {
        if (
            global.data &&
            Array.isArray(global.data.allThreadID)
        ) {
            global.data.allThreadID =
                global.data.allThreadID.filter(
                    x => String(x) !== id
                );
        }
    } catch {}

    try {
        if (
            global.data &&
            global.data.threadData
        ) {
            delete global.data.threadData[id];
        }
    } catch {}

    try {
        if (
            global.client &&
            global.client.threadData
        ) {
            delete global.client.threadData[id];
        }
    } catch {}
}

// ==================================================
// تنظيف مجموعة
// ==================================================

async function cleanThread(api, threadID) {
    const id = String(threadID);

    const test = await testGroupByMessage(
        api,
        id
    );

    // إذا نجح الإرسال فالبوت ما زال داخل المجموعة
    if (test.success) {
        return {
            success: false,
            active: true,
            error:
                "البوت ما زال داخل المجموعة وتمكن من إرسال رسالة"
        };
    }

    const deleted = await deleteThread(
        api,
        id
    );

    if (!deleted.success) {
        return {
            success: false,
            active: false,
            error: deleted.error
        };
    }

    removeLeftThread(id);
    removeFromKnownThreads(id);

    return {
        success: true,
        active: false
    };
}

// ==================================================
// الأمر الرئيسي
// ==================================================

module.exports.run = async function ({
    api,
    event,
    Threads
}) {
    const senderID = String(event.senderID);

    // التحقق من المطور
    if (senderID !== DEV_ID) {
        return api.sendMessage(
            "هذا الأمر للمطور فقط",
            event.threadID,
            event.messageID
        );
    }

    const threadIDs = await collectThreadIDs(
        api,
        Threads
    );

    const leftThreads = getLeftThreads();

    // إضافة المجموعات المسجلة سابقاً
    for (const id of Object.keys(leftThreads)) {
        threadIDs.add(String(id));
    }

    const groups = [];

    for (const id of threadIDs) {
        try {
            const info = await getRealThreadInfo(
                api,
                id
            );

            if (info) {
                groups.push({
                    id,
                    name: getGroupName(info, id),
                    members: getMemberCount(info),
                    unavailable: false
                });

                continue;
            }

            const oldInfo = leftThreads[id] || {};

            saveLeftThread(id, {
                threadName:
                    oldInfo.threadName ||
                    `مجموعة ${id}`
            });

            groups.push({
                id,
                name:
                    oldInfo.threadName ||
                    `مجموعة ${id}`,
                members: "غير متاح",
                unavailable: true
            });

        } catch {}
    }

    if (groups.length === 0) {
        return api.sendMessage(
            "لا توجد مجموعات مسجلة\n\nتعذر العثور على مجموعات من المصادر المتاحة.",
            event.threadID,
            event.messageID
        );
    }

    // ==================================================
    // إنشاء القائمة
    // ==================================================

    const banned = getBanned();

    let msg = "قائمة المجموعات\n\n";

    groups.forEach((group, index) => {
        const isBanned =
            banned[group.id] === true;

        msg +=
            `${index + 1}. ${group.name}\n` +
            `ID: ${group.id}\n` +
            `الأعضاء: ${group.members}\n` +
            `الحالة: ${
                group.unavailable
                    ? "غير متاحة"
                    : "متاحة"
            }\n` +
            `الحظر: ${
                isBanned
                    ? "محظورة"
                    : "غير محظورة"
            }\n\n`;
    });

    msg +=
        "الأوامر:\n" +
        "حظر N\n" +
        "الغاء_حظر N\n" +
        "خروج N\n" +
        "تنظيف N\n" +
        "تنظيف_الكل";

    return api.sendMessage(
        msg,
        event.threadID,
        (error, info) => {
            if (error || !info) return;

            if (!global.client.handleReply) {
                global.client.handleReply = [];
            }

            global.client.handleReply.push({
                name: "لاست",
                messageID: info.messageID,
                author: senderID,
                groups
            });
        },
        event.messageID
    );
};

// ==================================================
// الردود
// ==================================================

module.exports.handleReply = async function ({
    api,
    event,
    handleReply
}) {
    const senderID = String(event.senderID);

    if (senderID !== DEV_ID) {
        return;
    }

    if (!event.body) return;

    const body = event.body.trim();
    const groups = handleReply.groups || [];

    // ==================================================
    // تنظيف الكل
    // ==================================================

    if (body === "تنظيف_الكل") {
        const leftThreads = getLeftThreads();
        const ids = Object.keys(leftThreads);

        if (ids.length === 0) {
            return api.sendMessage(
                "لا توجد محادثات قديمة مسجلة للتنظيف",
                event.threadID,
                event.messageID
            );
        }

        let cleaned = 0;
        let active = 0;
        let failed = 0;

        for (const id of ids) {
            const result = await cleanThread(
                api,
                id
            );

            if (result.success) {
                cleaned++;
            } else if (result.active) {
                active++;
            } else {
                failed++;
            }
        }

        return api.sendMessage(
            "نتيجة التنظيف\n\n" +
            `تم تنظيف: ${cleaned}\n` +
            `ما زالت متاحة: ${active}\n` +
            `فشل: ${failed}`,
            event.threadID,
            event.messageID
        );
    }

    // ==================================================
    // استخراج الأمر والرقم
    // ==================================================

    const match = body.match(
        /^(حظر|الغاء_حظر|خروج|تنظيف)\s+(\d+)$/
    );

    if (!match) {
        return api.sendMessage(
            "الأمر غير صحيح\n\n" +
            "حظر N\n" +
            "الغاء_حظر N\n" +
            "خروج N\n" +
            "تنظيف N\n" +
            "تنظيف_الكل",
            event.threadID,
            event.messageID
        );
    }

    const action = match[1];
    const number = Number(match[2]);

    const group = groups[number - 1];

    if (!group) {
        return api.sendMessage(
            "رقم المجموعة غير موجود",
            event.threadID,
            event.messageID
        );
    }

    const groupID = String(group.id);

    // ==================================================
    // حظر
    // ==================================================

    if (action === "حظر") {
        const banned = getBanned();

        banned[groupID] = true;

        saveBanned(banned);

        return api.sendMessage(
            `تم حظر المجموعة\n\n${group.name}`,
            event.threadID,
            event.messageID
        );
    }

    // ==================================================
    // إلغاء الحظر
    // ==================================================

    if (action === "الغاء_حظر") {
        const banned = getBanned();

        delete banned[groupID];

        saveBanned(banned);

        return api.sendMessage(
            `تم إلغاء حظر المجموعة\n\n${group.name}`,
            event.threadID,
            event.messageID
        );
    }

    // ==================================================
    // خروج
    // ==================================================

    if (action === "خروج") {
        const left = await new Promise(resolve => {
            try {
                api.removeUserFromGroup(
                    api.getCurrentUserID(),
                    groupID,
                    error => {
                        if (error) {
                            resolve({
                                success: false,
                                error:
                                    error.message ||
                                    String(error)
                            });
                        } else {
                            resolve({
                                success: true
                            });
                        }
                    }
                );
            } catch (error) {
                resolve({
                    success: false,
                    error:
                        error.message ||
                        String(error)
                });
            }
        });

        if (!left.success) {
            return api.sendMessage(
                `فشل الخروج من المجموعة\n\n${left.error}`,
                event.threadID,
                event.messageID
            );
        }

        saveLeftThread(groupID, {
            threadName: group.name
        });

        removeFromKnownThreads(groupID);

        return api.sendMessage(
            `تم الخروج من المجموعة\n\n${group.name}`,
            event.threadID,
            event.messageID
        );
    }

    // ==================================================
    // تنظيف
    // ==================================================

    if (action === "تنظيف") {
        return api.sendMessage(
            `جاري اختبار الاتصال بالمجموعة\n\n${group.name}`,
            event.threadID,
            async error => {
                if (error) return;

                const result = await cleanThread(
                    api,
                    groupID
                );

                if (result.success) {
                    return api.sendMessage(
                        `تم تنظيف المحادثة بنجاح\n\n${group.name}`,
                        event.threadID
                    );
                }

                if (result.active) {
                    return api.sendMessage(
                        `البوت ما زال داخل المجموعة\n\n${group.name}\n\nلم يتم تنظيفها`,
                        event.threadID
                    );
                }

                return api.sendMessage(
                    `فشل تنظيف المحادثة\n\n${group.name}\n\nالسبب: ${result.error}`,
                    event.threadID
                );
            }
        );
    }
};
