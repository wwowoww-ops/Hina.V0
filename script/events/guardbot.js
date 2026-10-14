module.exports.config = {
    name: "guardBot",
    eventType: ["log:subscribe"],
    version: "1.3.0",
    credits: "أبو هريرة",
    description: "حماية زنجوبة من الإضافة بدون إذن المطور",
    category: "events"
};

// ==================================================
// المطورون المسموح لهم بإضافة البوت
// ==================================================

const DEVELOPER_IDS = [
    "61592700121061",
    "61578581225040",
    "61595042666074",
    "61594221091809" 
];

// ==================================================
// صورة التنبيه
// ==================================================

const GUARD_IMAGE_URL =
    "https://files.catbox.moe/njxao1.jpg";

// ==================================================
// المكتبات
// ==================================================

const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

// ==================================================
// مجلد الكاش
// ==================================================

const CACHE_DIR =
    path.join(
        __dirname,
        "cache"
    );

// ==================================================
// تحويل ID إلى String
// ==================================================

function normalizeID(id) {

    if (
        id === undefined ||
        id === null
    ) {
        return "";
    }

    return String(id).trim();

}

// ==================================================
// استخراج ID من مشارك
// ==================================================

function getParticipantID(participant) {

    if (!participant) {
        return "";
    }

    return normalizeID(
        participant.userFbId ||
        participant.userFbID ||
        participant.userID ||
        participant.userId ||
        participant.id ||
        participant.uid ||
        ""
    );

}

// ==================================================
// تحميل صورة الحماية
// ==================================================

async function downloadGuardImage() {

    if (
        !fs.existsSync(
            CACHE_DIR
        )
    ) {

        fs.ensureDirSync(
            CACHE_DIR
        );

    }

    const imagePath =
        path.join(
            CACHE_DIR,
            "guardBot.jpg"
        );

    try {

        const response =
            await axios.get(
                GUARD_IMAGE_URL,
                {
                    responseType:
                        "arraybuffer",

                    timeout:
                        30000
                }
            );

        fs.writeFileSync(
            imagePath,
            Buffer.from(
                response.data
            )
        );

        return imagePath;

    } catch (error) {

        console.error(
            "[guardBot] فشل تحميل صورة الحماية:",
            error.message
        );

        return null;

    }

}

// ==================================================
// حذف الصورة المؤقتة
// ==================================================

function removeGuardImage(
    imagePath
) {

    try {

        if (
            imagePath &&
            fs.existsSync(imagePath)
        ) {

            fs.unlinkSync(
                imagePath
            );

        }

    } catch (error) {

        console.error(
            "[guardBot] فشل حذف الصورة:",
            error.message
        );

    }

}

// ==================================================
// الحدث
// ==================================================

module.exports.handleEvent = async function ({
    api,
    event
}) {

    try {

        if (!event) {
            return;
        }

        // ==================================================
        // ID المجموعة
        // ==================================================

        const threadID =
            normalizeID(
                event.threadID
            );

        if (!threadID) {
            return;
        }

        // ==================================================
        // ID البوت
        // ==================================================

        let botID = "";

        try {

            if (
                api &&
                typeof api.getCurrentUserID ===
                "function"
            ) {

                botID =
                    normalizeID(
                        api.getCurrentUserID()
                    );

            }

        } catch (error) {

            console.error(
                "[guardBot] تعذر الحصول على ID البوت:",
                error.message
            );

        }

        if (!botID) {

            console.error(
                "[guardBot] تعذر الحصول على ID البوت"
            );

            return;
        }

        // ==================================================
        // بيانات الإضافة
        // ==================================================

        const logMessageData =
            event.logMessageData || {};

        const addedParticipants =
            Array.isArray(
                logMessageData.addedParticipants
            )
                ? logMessageData.addedParticipants
                : [];

        if (
            addedParticipants.length === 0
        ) {
            return;
        }

        // ==================================================
        // IDs الأشخاص الذين تمت إضافتهم
        // ==================================================

        const addedIDs =
            addedParticipants
                .map(
                    participant =>
                        getParticipantID(
                            participant
                        )
                )
                .filter(Boolean);

        console.log(
            `[guardBot] Added IDs: ${addedIDs.join(", ")}`
        );

        // ==================================================
        // التأكد أن البوت تمت إضافته
        // ==================================================

        const botAdded =
            addedIDs.includes(
                botID
            );

        if (!botAdded) {
            return;
        }

        // ==================================================
        // الشخص الذي أضاف البوت
        // ==================================================

        const author =
            normalizeID(
                event.author ||
                event.senderID ||
                logMessageData.author ||
                logMessageData.authorID ||
                logMessageData.actor ||
                logMessageData.actorID ||
                ""
            );

        console.log(
            `[guardBot] Bot ID: ${botID}`
        );

        console.log(
            `[guardBot] Author ID: ${author || "غير معروف"}`
        );

        console.log(
            `[guardBot] Thread ID: ${threadID}`
        );

        // ==================================================
        // إذا لم نعرف صاحب الإضافة
        // ==================================================

        if (!author) {

            console.error(
                "[guardBot] لم يتم العثور على ID الشخص الذي أضاف البوت"
            );

            console.error(
                "[guardBot] Event:",
                JSON.stringify(
                    event,
                    null,
                    2
                )
            );

            return;
        }

        // ==================================================
        // التحقق من المطور
        // ==================================================

        const isDeveloper =
            DEVELOPER_IDS.includes(
                author
            );

        // ==================================================
        // إضافة مصرح بها
        // ==================================================

        if (isDeveloper) {

            console.log(
                `[guardBot] تمت إضافة البوت بواسطة مطور مصرح به: ${author}`
            );

            return;
        }

        // ==================================================
        // إضافة غير مصرح بها
        // ==================================================

        console.log(
            "[guardBot] ⚠️ إضافة غير مصرح بها"
        );

        console.log(
            `[guardBot] الشخص: ${author}`
        );

        console.log(
            `[guardBot] المجموعة: ${threadID}`
        );

        // ==================================================
        // تحميل الصورة
        // ==================================================

        const imagePath =
            await downloadGuardImage();

        // ==================================================
        // الرسالة المتوافقة مع الصورة
        // ==================================================

        const message =
`⌬ ━━ HINA UTILITY ━━ ⌬

⚠️ تنبيه أمني

تمت إضافة HINA إلى هذه المجموعة بدون إذن المطور

هذه الإضافة غير مصرح بها
لذلك سيتم مغادرة المجموعة الآن

يرجى الحصول على إذن المطور قبل إعادة الإضافة`;

        // ==================================================
        // إرسال الصورة + الرسالة
        // ==================================================

        try {

            if (
                imagePath &&
                fs.existsSync(imagePath)
            ) {

                await new Promise(
                    resolve => {

                        api.sendMessage(
                            {
                                body:
                                    message,

                                attachment:
                                    fs.createReadStream(
                                        imagePath
                                    )
                            },

                            threadID,

                            error => {

                                if (error) {

                                    console.error(
                                        "[guardBot] فشل إرسال الصورة والرسالة:",
                                        error
                                    );

                                }

                                resolve();

                            }
                        );

                    }
                );

            } else {

                await new Promise(
                    resolve => {

                        api.sendMessage(
                            message,
                            threadID,
                            error => {

                                if (error) {

                                    console.error(
                                        "[guardBot] فشل إرسال الرسالة:",
                                        error
                                    );

                                }

                                resolve();

                            }
                        );

                    }
                );

            }

        } catch (error) {

            console.error(
                "[guardBot] خطأ أثناء إرسال التنبيه:",
                error
            );

        }

        // ==================================================
        // تنظيف الصورة
        // ==================================================

        removeGuardImage(
            imagePath
        );

        // ==================================================
        // انتظار بسيط
        // ==================================================

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    1000
                )
        );

        // ==================================================
        // إخراج البوت
        // ==================================================

        try {

            await new Promise(
                (resolve, reject) => {

                    api.removeUserFromGroup(
                        botID,
                        threadID,
                        error => {

                            if (error) {

                                console.error(
                                    "[guardBot] فشل خروج البوت:",
                                    error
                                );

                                return reject(
                                    error
                                );

                            }

                            console.log(
                                `[guardBot] خرج البوت بنجاح من: ${threadID}`
                            );

                            resolve();

                        }
                    );

                }
            );

        } catch (error) {

            console.error(
                "[guardBot] Remove User Error:",
                error
            );

        }

    } catch (error) {

        console.error(
            "================================="
        );

        console.error(
            "❌ GUARD BOT ERROR"
        );

        console.error(
            error
        );

        console.error(
            "================================="
        );

    }

};