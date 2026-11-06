
const https = require("https");
const http = require("http");
const { Readable } = require("stream");

// =============================================
// HINA RECOVERY - نقل المجموعات
// =============================================

module.exports.config = {
  name: "نقل",
  version: "3.0.0",
  hasPermssion: 0,
  credits: "أبو هريرة",
  description: "حفظ واستعادة المجموعات مؤقتاً",
  commandCategory: "developer",
  usages: "نقل حفظ [الاسم] | نقل",
  cooldowns: 5
};

// التخزين المؤقت
const backups = Object.create(null);

const MAX_RETRIES = 3;
const API_TIMEOUT = 30000;

// =============================================
// أدوات مساعدة
// =============================================

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function isDeveloper(id) {
  const developers = (global.config?.ADMINBOT || [])
    .map(String);

  return developers.includes(String(id));
}

// استدعاء API مع دعم Callback و Promise
function callApi(api, method, args = [], timeout = API_TIMEOUT) {

  return new Promise((resolve, reject) => {

    if (typeof api[method] !== "function") {
      return reject(
        new Error(`الدالة ${method} غير مدعومة في API`)
      );
    }

    let completed = false;

    const timer = setTimeout(() => {
      finish(
        new Error(`انتهت مهلة تنفيذ ${method}`)
      );
    }, timeout);

    function finish(error, result) {

      if (completed) return;

      completed = true;
      clearTimeout(timer);

      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }

    const callback = (error, result) => {

      if (error instanceof Error) {
        return finish(error);
      }

      if (error) {
        return finish(new Error(String(error)));
      }

      if (arguments.length > 1) {
        return finish(null, result);
      }

      finish(null, error);
    };

    try {

      const returned = api[method](
        ...args,
        callback
      );

      if (returned && typeof returned.then === "function") {

        returned.then(
          result => finish(null, result),
          error => finish(error)
        );

      } else if (returned !== undefined) {

        finish(null, returned);
      }

    } catch (error) {

      finish(error);
    }
  });
}

// إرسال رسالة مع دعم Callback و Promise
function sendMessage(api, message, threadID, replyToID = null) {

  return new Promise((resolve, reject) => {

    let completed = false;

    const timer = setTimeout(() => {
      finish(
        new Error("انتهت مهلة إرسال الرسالة")
      );
    }, API_TIMEOUT);

    function finish(error, result) {

      if (completed) return;

      completed = true;
      clearTimeout(timer);

      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }

    const callback = (error, result) => {

      if (error) {
        return finish(
          error instanceof Error
            ? error
            : new Error(String(error))
        );
      }

      finish(null, result);
    };

    try {

      const returned = api.sendMessage(
        message,
        threadID,
        callback,
        replyToID
      );

      if (returned && typeof returned.then === "function") {

        returned.then(
          result => finish(null, result),
          error => finish(error)
        );

      } else if (returned !== undefined) {

        finish(null, returned);
      }

    } catch (error) {

      finish(error);
    }
  });
}

function send(api, message, threadID, replyToID = null) {
  return sendMessage(api, message, threadID, replyToID);
}

// إعادة المحاولة
async function retry(callback) {

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {

    try {

      await callback();

      return {
        success: true,
        attempts: attempt
      };

    } catch (error) {

      lastError = error;

      if (attempt < MAX_RETRIES) {
        await sleep(attempt * 1500);
      }
    }
  }

  return {
    success: false,
    attempts: MAX_RETRIES,
    error: lastError?.message || "خطأ غير معروف"
  };
}

// تحميل صورة المجموعة
function downloadImage(url, redirects = 3) {

  return new Promise((resolve, reject) => {

    if (!url) {
      return reject(new Error("رابط الصورة غير موجود"));
    }

    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      return reject(new Error("رابط الصورة غير صالح"));
    }

    if (!["https:", "http:"].includes(parsed.protocol)) {
      return reject(new Error("نوع رابط الصورة غير مدعوم"));
    }

    const client =
      parsed.protocol === "https:"
        ? https
        : http;

    const request = client.get(parsed, response => {

      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {

        response.resume();

        if (redirects <= 0) {
          return reject(
            new Error("تجاوز عدد تحويلات الصورة")
          );
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
          new Error(
            `فشل تحميل الصورة: ${response.statusCode}`
          )
        );
      }

      const chunks = [];

      response.on("data", chunk => {
        chunks.push(chunk);
      });

      response.on("end", () => {
        resolve(Buffer.concat(chunks));
      });

      response.on("error", reject);
    });

    request.setTimeout(20000, () => {
      request.destroy(
        new Error("انتهت مهلة تحميل الصورة")
      );
    });

    request.on("error", reject);
  });
}

// =============================================
// تنفيذ الأمر
// =============================================

module.exports.run = async function({
  api,
  event,
  args
}) {

  const {
    threadID,
    messageID,
    senderID
  } = event;

  if (!isDeveloper(senderID)) {
    return send(
      api,
      "⛔ هذا الأمر مخصص لمطوري HINA فقط.",
      threadID,
      messageID
    );
  }

  global.client ||= {};
  global.client.handleReply ||= [];

  // ===========================================
  // حفظ المجموعة
  // ===========================================

  if (args[0] === "حفظ") {

    const name = args.slice(1).join(" ").trim();

    if (!name) {
      return send(
        api,
        "الاستخدام:\nنقل حفظ [اسم النسخة]",
        threadID,
        messageID
      );
    }

    if (backups[name]?.busy) {
      return send(
        api,
        "⚠️ هذه النسخة قيد الاستعادة حالياً.",
        threadID,
        messageID
      );
    }

    // إشعار فوري
    try {

      await send(
        api,
        `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
        `⏳ جارٍ حفظ المجموعة...\n\n` +
        `📌 اسم النسخة: ${name}\n` +
        `يرجى الانتظار.`,
        threadID,
        messageID
      );

    } catch (error) {

      console.error("HINA SAVE NOTICE:", error);
    }

    try {

      // جلب معلومات المجموعة
      const info = await callApi(
        api,
        "getThreadInfo",
        [threadID]
      );

      if (!info) {
        throw new Error("لم تصل معلومات المجموعة.");
      }

      const members = (
        info.participantIDs || []
      ).map(String);

      const nicknames = info.nicknames || {};

      // إنشاء النسخة
      backups[name] = {

        name,

        originalThreadID: String(threadID),

        groupName: info.threadName || "",

        image: info.imageSrc || null,

        members,

        nicknames,

        savedAt: new Date().toLocaleString("ar"),

        busy: false
      };

      return send(
        api,
        `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
        `✅ تم حفظ المجموعة بنجاح!\n\n` +
        `📌 النسخة: ${name}\n` +
        `🏷️ اسم المجموعة: ${info.threadName || "غير معروف"}\n` +
        `👥 عدد الأعضاء: ${members.length}\n` +
        `🖼️ الصورة: ${info.imageSrc ? "تم تسجيلها" : "غير متوفرة"}\n` +
        `🆔 المجموعة: ${threadID}\n` +
        `📅 التاريخ: ${backups[name].savedAt}\n\n` +
        `استخدم "نقل" لعرض النسخ المحفوظة.`,
        threadID,
        messageID
      );

    } catch (error) {

      console.error("HINA SAVE ERROR:", error);

      return send(
        api,
        `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
        `❌ فشل حفظ المجموعة!\n\n` +
        `📌 النسخة: ${name}\n` +
        `⚠️ السبب:\n${error.message}`,
        threadID,
        messageID
      );
    }
  }

  // ===========================================
  // عرض النسخ المحفوظة
  // ===========================================

  if (!args.length) {

    const names = Object.keys(backups);

    if (!names.length) {
      return send(
        api,
        "📂 لا توجد نسخ مؤقتة محفوظة حالياً.",
        threadID,
        messageID
      );
    }

    // تثبيت ترتيب النسخ لهذه القائمة
    const backupNames = [...names];

    let message =
      `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
      `📂 النسخ المحفوظة:\n\n`;

    backupNames.forEach((name, index) => {

      const backup = backups[name];

      message +=
        `${index + 1}. ${name}\n` +
        `👥 الأعضاء: ${backup.members.length}\n` +
        `📅 ${backup.savedAt}\n\n`;
    });

    message +=
      `━━━━━━━━━━━━━━━━\n` +
      `↩️ رد على هذه الرسالة برقم النسخة لاستعادتها.\n` +
      `⚠️ يجب أن يكون HINA مشرفاً في المجموعة المستقبلة.`;

    try {

      const sent = await send(
        api,
        message,
        threadID
      );

      if (!sent?.messageID) {
        throw new Error(
          "لم يتم الحصول على رقم رسالة القائمة."
        );
      }

      global.client.handleReply.push({

        name: module.exports.config.name,

        messageID: sent.messageID,

        author: String(senderID),

        type: "restore",

        backupNames
      });

    } catch (error) {

      console.error("HINA LIST ERROR:", error);

      return send(
        api,
        `❌ تعذر عرض قائمة النسخ أو تسجيل الرد.\n\n` +
        `السبب: ${error.message}`,
        threadID,
        messageID
      );
    }

    return;
  }

  return send(
    api,
    `الاستخدام:\n\n` +
    `نقل حفظ [اسم النسخة]\n` +
    `نقل\n\n` +
    `اختر النسخة بالرد على القائمة.`,
    threadID,
    messageID
  );
};

// =============================================
// استقبال الرد واختيار النسخة
// =============================================

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

  global.client ||= {};
  global.client.handleReply ||= [];

  if (!isDeveloper(senderID)) {
    return send(
      api,
      "⛔ هذا الأمر مخصص لمطوري HINA فقط.",
      threadID,
      messageID
    );
  }

  if (String(senderID) !== String(handleReply.author)) {
    return send(
      api,
      "⛔ هذه القائمة ليست خاصة بك.",
      threadID,
      messageID
    );
  }

  if (handleReply.type !== "restore") return;

  const choice = String(body || "").trim();

  if (!/^\d+$/.test(choice)) {
    return send(
      api,
      "⚠️ أرسل رقم النسخة فقط بالرد على القائمة.",
      threadID,
      messageID
    );
  }

  const names = handleReply.backupNames || [];
  const index = Number(choice) - 1;

  if (index < 0 || index >= names.length) {
    return send(
      api,
      "❌ رقم النسخة غير صحيح.",
      threadID,
      messageID
    );
  }

  const name = names[index];
  const backup = backups[name];

  if (!backup) {
    return send(
      api,
      "❌ هذه النسخة لم تعد موجودة في الذاكرة.",
      threadID,
      messageID
    );
  }

  if (backup.busy) {
    return send(
      api,
      "⏳ هذه النسخة قيد الاستعادة بالفعل.",
      threadID,
      messageID
    );
  }

  if (backup.originalThreadID === String(threadID)) {
    return send(
      api,
      "⚠️ لا يمكن استعادة المجموعة داخل المجموعة الأصلية.",
      threadID,
      messageID
    );
  }

  // ===========================================
  // التحقق من المجموعة المستقبلة
  // ===========================================

  let targetInfo;

  try {

    targetInfo = await callApi(
      api,
      "getThreadInfo",
      [threadID]
    );

    const botID = String(api.getCurrentUserID());

    const adminIDs = (targetInfo.adminIDs || [])
      .map(admin =>
        String(
          typeof admin === "object"
            ? admin.id
            : admin
        )
      );

    if (!adminIDs.includes(botID)) {

      return send(
        api,
        "❌ يجب أن يكون HINA مشرفاً في المجموعة المستقبلة.",
        threadID,
        messageID
      );
    }

  } catch (error) {

    return send(
      api,
      `❌ تعذر قراءة المجموعة المستقبلة.\n\n` +
      `السبب: ${error.message}`,
      threadID,
      messageID
    );
  }

  // قفل النسخة
  backup.busy = true;

  // حذف مستمع الرد الحالي
  const replyIndex = global.client.handleReply.findIndex(
    item =>
      item.messageID === handleReply.messageID &&
      item.name === module.exports.config.name
  );

  if (replyIndex !== -1) {
    global.client.handleReply.splice(replyIndex, 1);
  }

  try {

    await send(
      api,
      `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
      `🚀 بدأت استعادة النسخة: ${name}\n\n` +
      `👥 الأعضاء: ${backup.members.length}\n` +
      `🔄 المحاولات: ${MAX_RETRIES}\n\n` +
      `⏳ قد تستغرق العملية بعض الوقت...`,
      threadID,
      messageID
    );

  } catch (error) {

    console.error("HINA RESTORE NOTICE:", error);
  }

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

    // =========================================
    // 1 - استعادة اسم المجموعة
    // =========================================

    if (backup.groupName) {

      await execute(
        "اسم المجموعة",
        async () => {

          await callApi(
            api,
            "setTitle",
            [
              backup.groupName,
              threadID
            ]
          );
        }
      );

    } else {

      results.push({
        label: "اسم المجموعة",
        success: true,
        attempts: 0,
        details: "لا يوجد اسم محفوظ"
      });
    }

    // =========================================
    // 2 - استعادة صورة المجموعة
    // =========================================

    if (backup.image) {

      await execute(
        "صورة المجموعة",
        async () => {

          const buffer = await downloadImage(
            backup.image
          );

          await callApi(
            api,
            "changeGroupImage",
            [
              Readable.from(buffer),
              threadID
            ]
          );
        }
      );

    } else {

      results.push({
        label: "صورة المجموعة",
        success: true,
        attempts: 0,
        details: "لا توجد صورة محفوظة"
      });
    }

    // =========================================
    // 3 - إضافة الأعضاء
    // =========================================

    const existing = new Set(
      (targetInfo.participantIDs || []).map(String)
    );

    const botID = String(api.getCurrentUserID());

    let added = 0;
    let alreadyExists = 0;
    let failedMembers = 0;

    for (const member of backup.members) {

      const id = String(member);

      if (id === botID) continue;

      if (existing.has(id)) {
        alreadyExists++;
        continue;
      }

      const result = await retry(async () => {

        await callApi(
          api,
          "addUserToGroup",
          [
            id,
            threadID
          ]
        );
      });

      if (result.success) {

        added++;
        existing.add(id);

      } else {

        failedMembers++;
      }

    }

    results.push({

      label: "الأعضاء",

      success: failedMembers === 0,

      attempts: MAX_RETRIES,

      details:
        `تمت الإضافة: ${added}\n` +
        `موجودون مسبقاً: ${alreadyExists}\n` +
        `فشل: ${failedMembers}`,

      error: failedMembers
        ? `تعذرت إضافة ${failedMembers} عضواً`
        : null
    });

    // =========================================
    // 4 - استعادة الكنيات
    // =========================================

    let nicknameSuccess = 0;
    let nicknameFailed = 0;
    let nicknameSkipped = 0;

    for (const [memberID, nickname] of Object.entries(
      backup.nicknames || {}
    )) {

      if (!nickname) continue;

      const id = String(memberID);

      // لا نعتبر تخطي الكنية نجاحاً كاملاً
      // إذا كان العضو غير موجود في المجموعة
      if (!existing.has(id)) {
        nicknameSkipped++;
        continue;
      }

      const result = await retry(async () => {

        await callApi(
          api,
          "changeNickname",
          [
            nickname,
            id,
            threadID
          ]
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

      success:
        nicknameFailed === 0 &&
        nicknameSkipped === 0,

      attempts: MAX_RETRIES,

      details:
        `نجح: ${nicknameSuccess}\n` +
        `فشل: ${nicknameFailed}\n` +
        `تخطي: ${nicknameSkipped}`,

      error:
        nicknameFailed || nicknameSkipped
          ? "لم تتم استعادة جميع الكنيات"
          : null
    });

    // =========================================
    // 5 - التقرير النهائي
    // =========================================

    const failed = results.filter(
      result => !result.success
    );

    const successful = results.filter(
      result => result.success
    );

    let report =
      `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
      `📂 النسخة: ${name}\n\n`;

    for (const result of results) {

      report +=
        `${result.success ? "✅" : "❌"} ${result.label}\n`;

      if (result.details) {

        report +=
          `${result.details}\n`;

      } else {

        report +=
          `المحاولات: ${result.attempts}/${MAX_RETRIES}\n`;

        if (!result.success) {
          report += `الخطأ: ${result.error}\n`;
        }
      }

      report += "\n";
    }

    report +=
      `━━━━━━━━━━━━━━━━\n` +
      `✅ العمليات الناجحة: ${successful.length}\n` +
      `❌ العمليات الفاشلة: ${failed.length}\n`;

    if (failed.length === 0) {

      // حذف النسخة بعد اكتمال الاستعادة
      delete backups[name];

      report +=
        `\n🎉 اكتملت الاستعادة بنجاح.\n` +
        `🗑️ تم حذف النسخة المؤقتة.`;

    } else {

      // الاحتفاظ بالنسخة لإعادة المحاولة
      backup.busy = false;

      report +=
        `\n⚠️ الاستعادة غير مكتملة.\n` +
        `📂 النسخة ما زالت محفوظة في ذاكرة HINA.\n` +
        `يمكنك كتابة "نقل" والمحاولة مجدداً.`;
    }

    return send(
      api,
      report,
      threadID,
      messageID
    );

  } catch (error) {

    backup.busy = false;

    console.error(
      "HINA RECOVERY ERROR:",
      error
    );

    return send(
      api,
      `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
      `❌ حدث خطأ غير متوقع.\n\n` +
      `السبب: ${error.message}\n\n` +
      `📂 النسخة ما زالت محفوظة في الذاكرة.`,
      threadID,
      messageID
    );
  }
};
