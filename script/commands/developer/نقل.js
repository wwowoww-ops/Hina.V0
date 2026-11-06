
const https = require("https");
const http = require("http");
const { Readable } = require("stream");

module.exports.config = {
  name: "نقل",
  version: "2.1.0",
  hasPermssion: 0,
  credits: "أبو هريرة",
  description: "حفظ واستعادة المجموعات مؤقتاً",
  commandCategory: "developer",
  usages: "نقل حفظ [الاسم] | نقل",
  cooldowns: 10
};

// تخزين مؤقت في الذاكرة
const backups = Object.create(null);
const MAX_RETRIES = 3;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function isDeveloper(id) {
  const developers = (global.config?.ADMINBOT || [])
    .map(String);

  return developers.includes(String(id));
}

// تحميل الصورة
function downloadImage(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error("لا توجد صورة"));

    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      return reject(new Error("رابط الصورة غير صالح"));
    }

    const client = parsed.protocol === "https:" ? https : http;

    const req = client.get(parsed, response => {

      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();

        if (redirects <= 0) {
          return reject(new Error("تجاوز تحويلات الرابط"));
        }

        const nextURL = new URL(
          response.headers.location,
          parsed
        ).href;

        return resolve(
          downloadImage(nextURL, redirects - 1)
        );
      }

      if (response.statusCode !== 200) {
        response.resume();
        return reject(
          new Error("فشل تحميل الصورة: " + response.statusCode)
        );
      }

      const chunks = [];

      response.on("data", chunk => chunks.push(chunk));

      response.on("end", () => {
        resolve(Buffer.concat(chunks));
      });

      response.on("error", reject);
    });

    req.setTimeout(15000, () => {
      req.destroy(new Error("انتهت مهلة تحميل الصورة"));
    });

    req.on("error", reject);
  });
}

// إعادة المحاولة 3 مرات
async function retry(callback) {

  let error;

  for (let i = 1; i <= MAX_RETRIES; i++) {

    try {
      await callback();

      return {
        success: true,
        attempts: i
      };

    } catch (e) {

      error = e;

      if (i < MAX_RETRIES) {
        await sleep(1000 * i);
      }
    }
  }

  return {
    success: false,
    attempts: MAX_RETRIES,
    error: error?.message || "Unknown error"
  };
}

module.exports.run = async function({ api, event, args }) {

  const {
    threadID,
    messageID,
    senderID
  } = event;

  const send = message =>
    api.sendMessage(message, threadID, messageID);

  // صلاحية المطورين
  if (!isDeveloper(senderID)) {
    return send("⛔ هذا الأمر مخصص لمطوري HINA فقط.");
  }

  // =====================================
  // حفظ المجموعة
  // =====================================

  if (args[0] === "حفظ") {

    const name = args.slice(1).join(" ").trim();

    if (!name) {
      return send("الاستخدام:\nنقل حفظ [اسم النسخة]");
    }

    if (backups[name]?.busy) {
      return send("⚠️ هذه النسخة قيد الاستخدام.");
    }

    try {

      const info = await api.getThreadInfo(threadID);

      backups[name] = {
        name,
        originalThreadID: threadID,
        groupName: info.threadName || "",
        image: info.imageSrc || null,
        members: info.participantIDs || [],
        nicknames: info.nicknames || {},
        savedAt: new Date().toLocaleString("ar"),
        busy: false
      };

      return send(
        `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
        `✅ تم حفظ المجموعة مؤقتاً\n\n` +
        `📌 الاسم: ${name}\n` +
        `👥 الأعضاء: ${backups[name].members.length}\n` +
        `🆔 المجموعة: ${threadID}\n\n` +
        `استخدم "نقل" لعرض النسخ.`
      );

    } catch (error) {

      return send(
        "❌ فشل حفظ المجموعة:\n" + error.message
      );
    }
  }

  // =====================================
  // عرض النسخ وإضافة HandleReply
  // =====================================

  if (!args.length) {

    const names = Object.keys(backups);

    if (!names.length) {
      return send("📂 لا توجد نسخ مؤقتة محفوظة.");
    }

    let message =
      `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
      `📂 النسخ المحفوظة:\n\n`;

    names.forEach((name, i) => {

      const backup = backups[name];

      message +=
        `${i + 1}. ${name}\n` +
        `👥 ${backup.members.length} عضواً\n` +
        `📅 ${backup.savedAt}\n\n`;
    });

    message +=
      `━━━━━━━━━━━━━━━━\n` +
      `↩️ رد على هذه الرسالة برقم النسخة لاستعادتها.`;

    const sent = await api.sendMessage(
      message,
      threadID
    );

    // تسجيل الرد في نظام HINA
    global.client.handleReply.push({
      name: module.exports.config.name,
      messageID: sent.messageID,
      author: String(senderID),
      type: "restore"
    });

    return;
  }

  return send(
    "الاستخدام:\n\n" +
    "نقل حفظ [اسم النسخة]\n" +
    "نقل\n\n" +
    "اختر النسخة بالرد على القائمة."
  );
};

// =====================================
// استقبال الرد واختيار النسخة
// =====================================

module.exports.handleReply = async function({
  api,
  event,
  handleReply
}) {

  const {
    threadID,
    messageID,
    senderID,
    body
  } = event;

  const send = message =>
    api.sendMessage(message, threadID, messageID);

  // التحقق من المطور
  if (!isDeveloper(senderID)) {
    return send("⛔ هذا الأمر مخصص للمطورين.");
  }

  // لا يسمح لشخص آخر باختيار النسخة
  if (String(senderID) !== String(handleReply.author)) {
    return send("⛔ هذه القائمة ليست خاصة بك.");
  }

  if (handleReply.type !== "restore") return;

  const choice = String(body || "").trim();

  if (!/^\d+$/.test(choice)) {
    return send("⚠️ أرسل رقم النسخة فقط بالرد على القائمة.");
  }

  const names = Object.keys(backups);
  const index = Number(choice) - 1;

  if (index < 0 || index >= names.length) {
    return send("❌ رقم النسخة غير صحيح.");
  }

  const name = names[index];
  const backup = backups[name];

  if (!backup) {
    return send("❌ النسخة لم تعد موجودة.");
  }

  if (backup.busy) {
    return send("⏳ هذه النسخة قيد الاستعادة.");
  }

  if (backup.originalThreadID === threadID) {
    return send("⚠️ لا يمكن استعادة المجموعة داخل نفسها.");
  }

  // التحقق من أن البوت أدمن في المجموعة الجديدة
  let targetInfo;

  try {

    targetInfo = await api.getThreadInfo(threadID);

    const botID = String(api.getCurrentUserID());

    const botAdmin = (targetInfo.adminIDs || [])
      .some(admin => String(admin.id) === botID);

    if (!botAdmin) {
      return send(
        "❌ يجب أن يكون HINA مشرفاً في المجموعة المستقبلة."
      );
    }

  } catch (error) {

    return send(
      "❌ تعذر قراءة المجموعة المستقبلة:\n" +
      error.message
    );
  }

  // قفل النسخة
  backup.busy = true;

  // حذف HandleReply الحالي
  const replyIndex = global.client.handleReply.findIndex(
    item =>
      item.messageID === handleReply.messageID
  );

  if (replyIndex !== -1) {
    global.client.handleReply.splice(replyIndex, 1);
  }

  await send(
    `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
    `🚀 بدأت استعادة النسخة: ${name}\n\n` +
    `🔄 المحاولات: 3 لكل عملية\n` +
    `👥 الأعضاء: ${backup.members.length}\n\n` +
    `⏳ يرجى الانتظار...`
  );

  const results = [];

  async function execute(label, callback) {

    const result = await retry(callback);

    results.push({
      label,
      ...result
    });

    return result.success;
  }

  try {

    // =====================================
    // 1 - استعادة الاسم
    // =====================================

    if (backup.groupName) {

      await execute("اسم المجموعة", async () => {

        if (typeof api.setTitle !== "function") {
          throw new Error("setTitle غير مدعوم");
        }

        await api.setTitle(
          backup.groupName,
          threadID
        );
      });

    }

    // =====================================
    // 2 - استعادة الصورة
    // =====================================

    if (backup.image) {

      await execute("صورة المجموعة", async () => {

        if (typeof api.changeGroupImage !== "function") {
          throw new Error("تغيير الصورة غير مدعوم");
        }

        const buffer = await downloadImage(backup.image);

        await api.changeGroupImage(
          Readable.from(buffer),
          threadID
        );

      });

    } else {

      results.push({
        label: "صورة المجموعة",
        success: true,
        attempts: 0,
        details: "لا توجد صورة محفوظة"
      });

    }

    // =====================================
    // 3 - إضافة الأعضاء
    // =====================================

    const existing = new Set(
      (targetInfo.participantIDs || []).map(String)
    );

    let added = 0;
    let failed = 0;
    let skipped = 0;

    for (const member of backup.members) {

      const id = String(member);

      // عدم إضافة البوت لنفسه
      if (id === String(api.getCurrentUserID())) {
        continue;
      }

      if (existing.has(id)) {
        skipped++;
        continue;
      }

      const result = await retry(async () => {

        if (typeof api.addUserToGroup !== "function") {
          throw new Error("إضافة الأعضاء غير مدعومة");
        }

        await api.addUserToGroup(id, threadID);

      });

      if (result.success) {
        added++;
        existing.add(id);
      } else {
        failed++;
      }

    }

    results.push({
      label: "الأعضاء",
      success: failed === 0,
      attempts: MAX_RETRIES,
      details:
        `تمت الإضافة: ${added} | ` +
        `موجودون: ${skipped} | ` +
        `فشل: ${failed}`
    });

    // =====================================
    // 4 - استعادة الكنيات
    // =====================================

    let nicknameSuccess = 0;
    let nicknameFailed = 0;
    let nicknameSkipped = 0;

    for (const [memberID, nickname] of Object.entries(
      backup.nicknames || {}
    )) {

      if (!nickname || !existing.has(String(memberID))) {
        nicknameSkipped++;
        continue;
      }

      const result = await retry(async () => {

        if (typeof api.changeNickname !== "function") {
          throw new Error("تغيير الكنيات غير مدعوم");
        }

        await api.changeNickname(
          nickname,
          String(memberID),
          threadID
        );

      });

      if (result.success) {
        nicknameSuccess++;
      } else {
        nicknameFailed++;
      }

    }

    results.push({
      label: "الكنيات",
      success: nicknameFailed === 0,
      attempts: MAX_RETRIES,
      details:
        `نجح: ${nicknameSuccess} | ` +
        `فشل: ${nicknameFailed} | ` +
        `تخطي: ${nicknameSkipped}`
    });

    // =====================================
    // 5 - التقرير النهائي
    // =====================================

    const failedOperations = results.filter(
      result => !result.success
    );

    const successfulOperations = results.filter(
      result => result.success
    );

    let report =
      `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
      `📂 النسخة: ${name}\n\n`;

    for (const result of results) {

      report +=
        `${result.success ? "✅" : "❌"} ${result.label}\n`;

      if (result.details) {
        report += `   ${result.details}\n`;
      } else {
        report += `   المحاولات: ${result.attempts}/3\n`;

        if (!result.success) {
          report += `   الخطأ: ${result.error}\n`;
        }
      }

      report += "\n";
    }

    report +=
      `━━━━━━━━━━━━━━━━\n` +
      `✅ العمليات الناجحة: ${successfulOperations.length}\n` +
      `❌ العمليات الفاشلة: ${failedOperations.length}\n`;

    // حذف النسخة فقط عند نجاح جميع العمليات
    if (failedOperations.length === 0) {

      delete backups[name];

      report +=
        `\n🎉 اكتملت الاستعادة.\n` +
        `🗑️ حُذفت النسخة المؤقتة.`;

    } else {

      backup.busy = false;

      report +=
        `\n⚠️ الاستعادة غير مكتملة.\n` +
        `📂 احتفظ HINA بالنسخة لإعادة المحاولة.\n\n` +
        `يمكنك كتابة "نقل" مجدداً واختيار النسخة.`;

    }

    return send(report);

  } catch (error) {

    backup.busy = false;

    console.error("HINA RECOVERY:", error);

    return send(
      `❌ خطأ غير متوقع أثناء الاستعادة:\n` +
      `${error.message}\n\n` +
      `📂 النسخة ما زالت محفوظة مؤقتاً.`
    );

  }

};
