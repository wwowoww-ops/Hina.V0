/**
 * سجن_الجروب.js
 * تغيير اسم المجموعة وكنيات أعضائها
 */

module.exports.config = {
    name: "سجن_الجروب",
    version: "1.0.0",
    hasPermssion: 2,
    credits: "أبو هريرة",
    description: "تغيير اسم المجموعة وكنيات الأعضاء",
    commandCategory: "developer",
    usages: "سجن_الجروب",
    cooldowns: 30
};

module.exports.run = async function ({
    api,
    event
}) {
    const { threadID, senderID, messageID } = event;

    const GROUP_NAME = "شلة السجن قاهرتكم ⛓️🔒";
    const NICKNAME = "سجين ⛓️";

    // السماح للمطور فقط
    const admins = [
        ...(Array.isArray(global.config?.ADMINBOT)
            ? global.config.ADMINBOT
            : []),
        ...(global.KIRA_CONF?.dev
            ? Array.isArray(global.KIRA_CONF.dev)
                ? global.KIRA_CONF.dev
                : [global.KIRA_CONF.dev]
            : [])
    ].map(String);

    if (!admins.includes(String(senderID))) {
        return api.sendMessage(
            "هذا الأمر للمطور فقط.",
            threadID,
            messageID
        );
    }

    const sleep = ms =>
        new Promise(resolve => setTimeout(resolve, ms));

    const send = message =>
        new Promise(resolve => {
            api.sendMessage(
                message,
                threadID,
                () => resolve(),
                messageID
            );
        });

    try {
        await send("⛓️ جارٍ تحديث اسم المجموعة والكنيات...");

        // تغيير اسم المجموعة
        await new Promise((resolve, reject) => {
            api.setTitle(GROUP_NAME, threadID, error => {
                if (error) reject(error);
                else resolve();
            });
        });

        // جلب الأعضاء
        const info = await api.getThreadInfo(threadID);
        const members = [
            ...new Set(
                (info.participantIDs || []).map(String)
            )
        ];

        let success = 0;
        let failed = 0;

        for (const userID of members) {
            try {
                await new Promise((resolve, reject) => {
                    api.changeNickname(
                        NICKNAME,
                        threadID,
                        userID,
                        error => {
                            if (error) reject(error);
                            else resolve();
                        }
                    );
                });

                success++;
            } catch (error) {
                failed++;
            }

            // فاصل قصير بين الطلبات
            await sleep(350);
        }

        return send(
            "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\n" +
            "🔒 اكتملت محاولة تحديث المجموعة\n\n" +
            `🏷️ الاسم: ${GROUP_NAME}\n` +
            `⛓️ الكنية: ${NICKNAME}\n\n` +
            `✅ نجحت الطلبات: ${success}\n` +
            `❌ فشلت الطلبات: ${failed}\n` +
            `👥 عدد الأعضاء: ${members.length}`
        );
    } catch (error) {
        console.error("[سجن_الجروب]", error);

        return send(
            "❌ تعذر إكمال العملية. تحقق من صلاحيات البوت وواجهة API."
        );
    }
};