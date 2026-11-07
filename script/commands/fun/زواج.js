
const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const jimp = require("jimp");

module.exports.config = {
  name: "زواج",
  version: "4.2.0",
  hasPermssion: 0,
  credits: "أبو هريرة",
  description: "نظام الزواج مع سجل دائم وقائمة المتزوجين",
  commandCategory: "fun",
  usages: "زواج [منشن/ID/رد] | زواج قائمة",
  cooldowns: 5,
  dependencies: {
    axios: "",
    "fs-extra": "",
    path: "",
    jimp: ""
  }
};

// =============================================
// HINA MARRIAGE SYSTEM
// =============================================

// منع تنفيذ عمليتي زواج متزامنتين في المجموعة نفسها
const activeThreads = new Set();

// =============================================
// HANDLE EVENT
// =============================================

module.exports.handleEvent = async function({ api, event }) {
  const { reaction, messageReply } = event;

  if (
    reaction === "👍" &&
    messageReply?.senderID === api.getCurrentUserID()
  ) {
    return api.unsendMessage(messageReply.messageID);
  }
};

// =============================================
// USER INFORMATION
// =============================================

async function getUserName(api, uid, fallback = "شخص") {
  try {
    const info = await api.getUserInfo(uid);

    return (
      info?.[uid]?.name ||
      info?.[uid]?.firstName ||
      fallback
    );
  } catch (error) {
    return fallback;
  }
}

// =============================================
// IMAGE CIRCLE
// =============================================

async function circle(image) {
  const img = await jimp.read(image);
  img.circle();
  return await img.getBufferAsync("image/png");
}

// =============================================
// LOAD MARRIAGES
// =============================================

const marriagePath = path.resolve("./data/marriages.json");

function loadMarriages() {
  fs.ensureDirSync(path.dirname(marriagePath));

  if (!fs.existsSync(marriagePath)) {
    fs.writeJsonSync(marriagePath, {});
  }

  try {
    const data = fs.readJsonSync(marriagePath);

    return data && typeof data === "object" && !Array.isArray(data)
      ? data
      : {};
  } catch (error) {
    throw new Error("تعذر قراءة سجل الزيجات. لم يتم تعديل الملف.");
  }
}

// =============================================
// SAFE SAVE
// =============================================

function saveMarriages(data) {
  const tempPath = marriagePath + ".tmp";

  try {
    fs.writeJsonSync(tempPath, data, { spaces: 2 });
    fs.renameSync(tempPath, marriagePath);
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

    throw error;
  }
}

// =============================================
// LIST MARRIED USERS
// =============================================

async function showMarriageList(api, threadID, messageID) {
  let marriages;

  try {
    marriages = loadMarriages();
  } catch (error) {
    return api.sendMessage(
      `⌬ ━━ HINA FUN ━━ ⌬

❌ تعذر قراءة سجل الزيجات.
📝 ${error.message}`,
      threadID,
      messageID
    );
  }

  const list = marriages[threadID] || [];

  if (!list.length) {
    return api.sendMessage(
      `⌬ ━━ HINA MARRIAGE ━━ ⌬

💔 لا توجد زيجات مسجلة في هذه المجموعة.`,
      threadID,
      messageID
    );
  }

  const validList = list.filter(
    m => m && m.user1 && m.user2
  );

  if (!validList.length) {
    return api.sendMessage(
      `⌬ ━━ HINA MARRIAGE ━━ ⌬

💔 لا توجد زيجات صالحة في السجل.`,
      threadID,
      messageID
    );
  }

  const entries = await Promise.all(
    validList.map(async (marriage, index) => {
      const [name1, name2] = await Promise.all([
        getUserName(api, marriage.user1),
        getUserName(api, marriage.user2)
      ]);

      return `${index + 1}. 💍 ${name1} ❤️ ${name2}
   📅 ${marriage.date || "تاريخ غير معروف"}`;
    })
  );

  const message =
    `⌬ ━━ HINA MARRIAGE ━━ ⌬

💍 قائمة المتزوجين

👥 عدد الزيجات: ${validList.length}

━━━━━━━━━━━━━━━━━━

${entries.join("\n\n")}

━━━━━━━━━━━━━━━━━━
💕 نتمنى السعادة لجميع الأزواج!`;

  return api.sendMessage(
    message,
    threadID,
    messageID
  );
}

// =============================================
// CLEANUP
// =============================================

function cleanupFiles(files) {
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (error) {
      console.error("HINA CLEANUP ERROR:", error.message);
    }
  }
}

// =============================================
// MAIN COMMAND
// =============================================

module.exports.run = async function({
  api,
  event,
  args,
  Users,
  Threads,
  Currencies,
  models
}) {

  const {
    threadID,
    messageID,
    senderID,
    mentions,
    messageReply
  } = event;

  // =============================================
  // MARRIAGE LIST COMMAND
  // =============================================

  if (
    args[0] &&
    ["قائمة", "المتزوجين", "list"].includes(args[0].toLowerCase())
  ) {
    return showMarriageList(api, threadID, messageID);
  }

  // =============================================
  // CACHE DIRECTORY
  // =============================================

  const cacheDir = path.join(__dirname, "cache", "canvas");

  fs.ensureDirSync(cacheDir);

  // =============================================
  // TARGET SELECTION
  // =============================================

  let targetID;
  let targetName = "شخص";

  if (Object.keys(mentions || {}).length > 0) {

    targetID = Object.keys(mentions)[0];

    targetName = String(
      mentions[targetID] || ""
    ).replace("@", "") || "شخص";

  } else if (messageReply?.senderID) {

    targetID = messageReply.senderID;

  } else if (args[0] && /^\d+$/.test(args[0])) {

    targetID = args[0];

  }

  if (!targetID) {
    return api.sendMessage(
      `⌬ ━━ HINA FUN ━━ ⌬

📝 أوامر الزواج:

💍 زواج @منشن
💍 زواج [ID]
💍 الرد على رسالة العضو ثم زواج

📋 زواج قائمة

لعرض جميع المتزوجين في المجموعة.`,
      threadID,
      messageID
    );
  }

  targetID = String(targetID);
  const currentID = String(senderID);
  const botID = String(api.getCurrentUserID());

  // =============================================
  // BASIC PROTECTION
  // =============================================

  if (targetID === botID) {
    return api.sendMessage(
      `⌬ ━━ HINA FUN ━━ ⌬

😅 لا يمكن الزواج مني! أنا هنا لمساعدتك فقط.`,
      threadID,
      messageID
    );
  }

  if (targetID === currentID) {
    return api.sendMessage(
      `⌬ ━━ HINA FUN ━━ ⌬

😅 لا يمكن الزواج من نفسك!`,
      threadID,
      messageID
    );
  }

  // =============================================
  // DEVELOPER PROTECTION
  // =============================================

  let config = {};

  try {
    config = fs.readJsonSync("./config.json");
  } catch (error) {
    console.error("HINA CONFIG ERROR:", error.message);
  }

  const devID = String(
    config.KIRA_CONF?.dev ||
    config.ADMINBOT?.[0] ||
    ""
  );

  if (devID && targetID === devID) {
    return api.sendMessage(
      `⌬ ━━ HINA FUN ━━ ⌬

🛡️ لا يمكن الزواج من المطور!`,
      threadID,
      messageID
    );
  }

  // =============================================
  // PREVENT CONCURRENT MARRIAGES
  // =============================================

  if (activeThreads.has(threadID)) {
    return api.sendMessage(
      `⌬ ━━ HINA FUN ━━ ⌬

⏳ توجد مراسم زواج قيد التنفيذ في هذه المجموعة.
يرجى الانتظار قليلاً.`,
      threadID,
      messageID
    );
  }

  activeThreads.add(threadID);

  // =============================================
  // IMAGE PATHS
  // =============================================

  const pathImg = path.join(
    cacheDir,
    `marry_${senderID}_${targetID}.png`
  );

  const avatarOnePath = path.join(
    cacheDir,
    `avt_${senderID}.png`
  );

  const avatarTwoPath = path.join(
    cacheDir,
    `avt_${targetID}.png`
  );

  const backgroundPath = path.join(
    cacheDir,
    "marry_bg.png"
  );

  try {

    // =============================================
    // LOAD MARRIAGES
    // =============================================

    const marriages = loadMarriages();

    if (!Array.isArray(marriages[threadID])) {
      marriages[threadID] = [];
    }

    // =============================================
    // CHECK EXISTING MARRIAGE
    // =============================================

    const existingMarriage = marriages[threadID].find(
      m =>
        String(m.user1) === currentID ||
        String(m.user2) === currentID ||
        String(m.user1) === targetID ||
        String(m.user2) === targetID
    );

    if (existingMarriage) {

      const user1 = String(existingMarriage.user1);
      const user2 = String(existingMarriage.user2);

      if (
        (user1 === currentID && user2 === targetID) ||
        (user2 === currentID && user1 === targetID)
      ) {
        return api.sendMessage(
          `⌬ ━━ HINA FUN ━━ ⌬

💕 أنتما متزوجان بالفعل! 💕

📅 تاريخ الزواج:
${existingMarriage.date}`,
          threadID,
          messageID
        );
      }

      let partnerID;

      if (user1 === currentID) {
        partnerID = user2;
      } else if (user2 === currentID) {
        partnerID = user1;
      } else if (user1 === targetID) {
        partnerID = user2;
      } else {
        partnerID = user1;
      }

      const partnerName = await getUserName(
        api,
        partnerID
      );

      return api.sendMessage(
        `⌬ ━━ HINA FUN ━━ ⌬

⛔ ${partnerName} متزوج بالفعل!
لا يمكن إتمام زواج جديد.`,
        threadID,
        messageID
      );
    }

    // =============================================
    // GET NAMES
    // =============================================

    const senderName = await getUserName(
      api,
      senderID
    );

    const fetchedTargetName = await getUserName(
      api,
      targetID,
      targetName
    );

    targetName = fetchedTargetName;

    // =============================================
    // MARRIAGE DATE
    // =============================================

    const marriageDate = new Date().toLocaleString("ar", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    // =============================================
    // ORIGINAL IMAGE SYSTEM
    // DO NOT MODIFY
    // =============================================

    if (!fs.existsSync(backgroundPath)) {
      const bgRes = await axios.get("https://i.ibb.co/9ZZCSzR/ba6abadae46b5bdaa29cf6a64d762874.jpg", { responseType: "arraybuffer" });
      fs.writeFileSync(backgroundPath, Buffer.from(bgRes.data, "utf-8"));
    }

    const getAvt = async (uid, savePath) => {
      const url = `https://graph.facebook.com/${uid}/picture?width=512&height=512&access_token=6628568379%7Cc1e620fa708a1d5696fb991c1bde5662`;
      const res = await axios.get(url, { responseType: "arraybuffer" });
      fs.writeFileSync(savePath, Buffer.from(res.data, "utf-8"));
      return savePath;
    };

    await Promise.all([
      getAvt(senderID, avatarOnePath),
      getAvt(targetID, avatarTwoPath)
    ]);

    const baseImage = await jimp.read(backgroundPath);
    const circleOne = await jimp.read(await circle(avatarOnePath));
    const circleTwo = await jimp.read(await circle(avatarTwoPath));

    baseImage.composite(circleOne.resize(130, 130), 200, 70)
              .composite(circleTwo.resize(130, 130), 350, 150);

    const buffer = await baseImage.getBufferAsync("image/png");
    fs.writeFileSync(pathImg, buffer);

    // =============================================
    // SAVE MARRIAGE
    // =============================================

    marriages[threadID].push({
      user1: currentID,
      user2: targetID,
      date: marriageDate,
      timestamp: Date.now()
    });

    saveMarriages(marriages);

    // =============================================
    // MARRIAGE MESSAGE
    // =============================================

    const funnyReplies = [
      `💍 ألف مبروك الزواج لـ ${senderName} و ${targetName}! 🎉
📅 تاريخ الزواج: ${marriageDate}`,

      `💕 تم الزواج! ${senderName} و ${targetName} أصبحا زوجين! 🥂
📅 ${marriageDate}`,

      `🌸 مبارك للعروسين ${senderName} و ${targetName}! 💐
📅 ${marriageDate}`,

      `💖 زواج سعيد لـ ${senderName} و ${targetName}! 🎊
📅 ${marriageDate}`
    ];

    const randomReply = funnyReplies[
      Math.floor(Math.random() * funnyReplies.length)
    ];

    // =============================================
    // SEND MARRIAGE
    // =============================================

    return api.sendMessage(
      {
        body: `⌬ ━━ HINA FUN ━━ ⌬

${randomReply}

📋 لعرض قائمة المتزوجين:
زواج قائمة`,
        attachment: fs.createReadStream(pathImg)
      },
      threadID,
      () => {
        cleanupFiles([
          pathImg,
          avatarOnePath,
          avatarTwoPath
        ]);
      },
      messageID
    );

  } catch (error) {

    console.error("HINA MARRIAGE ERROR:", error);

    cleanupFiles([
      pathImg,
      avatarOnePath,
      avatarTwoPath
    ]);

    return api.sendMessage(
      `⌬ ━━ HINA FUN ━━ ⌬

❌ حدث خطأ في إتمام مراسم الزواج!

📝 ${error.message}`,
      threadID,
      messageID
    );

  } finally {

    activeThreads.delete(threadID);

  }
};
