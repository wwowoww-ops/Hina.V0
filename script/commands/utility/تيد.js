const axios = require("axios");
const fs = require("fs");
const path = require("path");

module.exports.config = {
  name: "تيد",
  version: "2.0.0",
  hasPermssion: 0,
  credits: "أبو هريرة",
  description: "عرض معلومات المجموعة",
  commandCategory: "utility",
  usages: "تيد",
  cooldowns: 2
};

const HEADER =
  "⌬ ━━ 𝗛𝗜𝗡𝗔  ━━ ⌬\n\n";

module.exports.run = async function ({
  api,
  event
}) {

  const threadID =
    String(event.threadID || "");

  const messageID =
    event.messageID;

  if (!threadID) {
    return;
  }

  try {

    // ==================================================
    // معلومات المجموعة
    // ==================================================

    const threadInfo =
      await new Promise((resolve, reject) => {

        api.getThreadInfo(
          threadID,
          (error, info) => {

            if (error) {
              reject(error);
              return;
            }

            resolve(info);
          }
        );

      });

    if (!threadInfo) {

      return api.sendMessage(
        HEADER +
        "تعذر الحصول على معلومات المجموعة.",
        threadID,
        messageID
      );
    }

    // ==================================================
    // اسم المجموعة
    // ==================================================

    const groupName =
      String(
        threadInfo.threadName ||
        threadInfo.name ||
        "بدون اسم"
      );

    // ==================================================
    // عدد الأعضاء
    // ==================================================

    let memberCount = 0;

    if (
      Array.isArray(
        threadInfo.participantIDs
      )
    ) {

      memberCount =
        threadInfo.participantIDs.length;

    } else if (
      Array.isArray(
        threadInfo.userInfo
      )
    ) {

      memberCount =
        threadInfo.userInfo.length;
    }

    // ==================================================
    // صورة المجموعة
    // ==================================================

    const imageURL =
      threadInfo.imageSrc ||
      threadInfo.threadPic ||
      threadInfo.image ||
      null;

    // ==================================================
    // النص
    // ==================================================

    const message =
      HEADER +
      `اسم المجموعة: ${groupName}\n` +
      `آيدي المجموعة: ${threadID}\n` +
      `عدد الأعضاء: ${memberCount}`;

    // ==================================================
    // بدون صورة
    // ==================================================

    if (!imageURL) {

      return api.sendMessage(
        message,
        threadID,
        messageID
      );
    }

    // ==================================================
    // ملف مؤقت
    // ==================================================

    const tempFile =
      path.join(
        __dirname,
        `group_${threadID}.jpg`
      );

    try {

      const response =
        await axios.get(
          imageURL,
          {
            responseType: "arraybuffer",
            timeout: 15000
          }
        );

      fs.writeFileSync(
        tempFile,
        Buffer.from(response.data)
      );

      // ==================================================
      // إرسال الصورة والمعلومات
      // ==================================================

      return api.sendMessage(
        {
          body: message,
          attachment: fs.createReadStream(
            tempFile
          )
        },
        threadID,
        (error) => {

          try {

            if (
              fs.existsSync(tempFile)
            ) {

              fs.unlinkSync(tempFile);
            }

          } catch (e) {}

          if (error) {

            console.error(
              "[TID SEND ERROR]:",
              error
            );
          }

        },
        messageID
      );

    } catch (error) {

      console.error(
        "[TID IMAGE ERROR]:",
        error
      );

      return api.sendMessage(
        message,
        threadID,
        messageID
      );
    }

  } catch (error) {

    console.error(
      "[TID ERROR]:",
      error
    );

    return api.sendMessage(
      HEADER +
      "حدث خطأ أثناء الحصول على معلومات المجموعة.",
      threadID,
      messageID
    );
  }
};