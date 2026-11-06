const https = require("https");
const http = require("http");
const { Readable } = require("stream");

// =============================================
// HINA RECOVERY - 3.1.0
// حفظ واستعادة المجموعات
// =============================================

module.exports.config = {
  name: "نقل",
  version: "3.1.0",
  hasPermssion: 0,
  credits: "أبو هريرة",
  description: "حفظ واستعادة المجموعات مؤقتاً",
  commandCategory: "developer",
  usages: "نقل حفظ [الاسم] | نقل",
  cooldowns: 5
};

// =============================================
// التخزين المؤقت
// =============================================

const backups = Object.create(null);

const MAX_RETRIES = 3;
const API_TIMEOUT = 30000;
const IMAGE_TIMEOUT = 20000;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

// =============================================
// أدوات مساعدة
// =============================================

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function errorMessage(error) {
  return error?.message || String(error || "خطأ غير معروف");
}

function isDeveloper(id) {
  const developers = (
    global.config?.ADMINBOT || []
  ).map(String);

  return developers.includes(String(id));
}

// =============================================
// استدعاء API
// دعم Callback و Promise
// =============================================

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

    function callback(error, result) {

      if (arguments.length >= 2) {

        if (error) {
          return finish(
            error instanceof Error
              ? error
              : new Error(String(error))
          );
        }

        return finish(null, result);
      }

      if (error instanceof Error) {
        return finish(error);
      }

      finish(null, error);
    }

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

// =============================================
// إرسال الرسائل
// =============================================

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

    function callback(error, result) {

      if (arguments.length >= 2) {

        if (error) {
          return finish(
            error instanceof Error
              ? error
              : new Error(String(error))
          );
        }

        return finish(null, result);
      }

      if (error instanceof Error) {
        return finish(error);
      }

      finish(null, error);
    }

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
  return sendMessage(
    api,
    message,
    threadID,
    replyToID
  );
}

// =============================================
// إرسال الصورة كمرفق
// =============================================

function sendImageAttachment(
  api,
  buffer,
  threadID,
  caption
) {

  return sendMessage(
    api,
    {
      body: caption,
      attachment: Readable.from([buffer])
    },
    threadID
  );
}

// =============================================
// إعادة المحاولة التلقائية
// =============================================

async function retry(callback) {

  let lastError;

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {

    try {

      const result = await callback(attempt);

      return {
        success: true,
        attempts: attempt,
        result
      };

    } catch (error) {

      lastError = error;

      console.error(
        `HINA RETRY ${attempt}/${MAX_RETRIES}:`,
        error
      );

      if (attempt < MAX_RETRIES) {

        await sleep(attempt * 1500);
      }
    }
  }

  return {
    success: false,
    attempts: MAX_RETRIES,
    error: errorMessage(lastError)
  };
}

// =============================================
// تنزيل الصورة
// =============================================

function downloadImage(url, redirects = 3) {

  return new Promise((resolve, reject) => {

    if (!url) {
      return reject(
        new Error("رابط الصورة غير موجود")
      );
    }

    let parsed;

    try {

      parsed = new URL(url);

    } catch {

      return reject(
        new Error("رابط الصورة غير صالح")
      );
    }

    if (!["https:", "http:"].includes(parsed.protocol)) {

      return reject(
        new Error("نوع رابط الصورة غير مدعوم")
      );
    }

    const client =
      parsed.protocol === "https:"
        ? https
        : http;

    const request = client.get(
      parsed,
      response => {

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

        const contentLength = Number(
          response.headers["content-length"] || 0
        );

        if (
          contentLength > MAX_IMAGE_SIZE
        ) {

          response.destroy();

          return reject(
            new Error("حجم الصورة أكبر من الحد المسموح")
          );
        }

        const chunks = [];
        let totalSize = 0;

        response.on("data", chunk => {

          totalSize += chunk.length;

          if (totalSize > MAX_IMAGE_SIZE) {

            request.destroy(
              new Error("تجاوز حجم الصورة الحد المسموح")
            );

            return;
          }

          chunks.push(chunk);
        });

        response.on("end", () => {

          if (!totalSize) {
            return reject(
              new Error("الصورة فارغة")
            );
          }

          resolve(
            Buffer.concat(chunks)
          );
        });

        response.on("error", reject);
      }
    );

    request.setTimeout(
      IMAGE_TIMEOUT,
      () => {

        request.destroy(
          new Error("انتهت مهلة تحميل الصورة")
        );
      }
    );

    request.on("error", reject);
  });
}

// =============================================
// استخراج صورة المجموعة
// =============================================

function getGroupImage(info) {

  return (
    info.imageSrc ||
    info.threadPic ||
    info.image ||
    null
  );
}

// =============================================
// تحديث قائمة الأعضاء
// =============================================

async function refreshMembers(api, threadID) {

  const info = await callApi(
    api,
    "getThreadInfo",
    [threadID]
  );

  return new Set(
    (info?.participantIDs || []).map(String)
  );
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
  // 1 - حفظ المجموعة
  // ===========================================

  if (args[0] === "حفظ") {

    const name = args
      .slice(1)
      .join(" ")
      .trim();

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

      console.error(
        "HINA SAVE NOTICE:",
        error
      );
    }

    try {

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

      const nicknames = {
        ...(info.nicknames || {})
      };

      const image = getGroupImage(info);

      backups[name] = {

        name,

        originalThreadID: String(threadID),

        groupName: info.threadName || "",

        image,

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
        `🖼️ الصورة: ${image ? "تم تسجيل رابطها" : "غير متوفرة"}\n` +
        `📝 الكنيات: ${Object.keys(nicknames).length}\n` +
        `🆔 المجموعة: ${threadID}\n` +
        `📅 التاريخ: ${backups[name].savedAt}\n\n` +
        `استخدم "نقل" لعرض النسخ المحفوظة.`,
        threadID,
        messageID
      );

    } catch (error) {

      console.error(
        "HINA SAVE ERROR:",
        error
      );

      return send(
        api,
        `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
        `❌ فشل حفظ المجموعة!\n\n` +
        `📌 النسخة: ${name}\n` +
        `⚠️ السبب:\n${errorMessage(error)}`,
        threadID,
        messageID
      );
    }
  }

  // ===========================================
  // 2 - عرض النسخ المحفوظة
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

    const backupNames = [...names];

    let message =
      `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
      `📂 النسخ المحفوظة:\n\n`;

    backupNames.forEach((name, index) => {

      const backup = backups[name];

      message +=
        `${index + 1}. ${name}\n` +
        `👥 الأعضاء: ${backup.members.length}\n` +
        `📝 الكنيات: ${Object.keys(backup.nicknames || {}).length}\n` +
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

      console.error(
        "HINA LIST ERROR:",
        error
      );

      return send(
        api,
        `❌ تعذر عرض قائمة النسخ أو تسجيل الرد.\n\n` +
        `السبب: ${errorMessage(error)}`,
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

  if (
    String(senderID) !==
    String(handleReply.author)
  ) {

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

  if (
    index < 0 ||
    index >= names.length
  ) {

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

  if (
    backup.originalThreadID ===
    String(threadID)
  ) {

    return send(
      api,
      "⚠️ لا يمكن استعادة المجموعة داخل المجموعة الأصلية.",
      threadID,
      messageID
    );
  }

  // ===========================================
  // 1 - التحقق من المجموعة المستقبلة
  // ===========================================

  let targetInfo;

  try {

    targetInfo = await callApi(
      api,
      "getThreadInfo",
      [threadID]
    );

    if (!targetInfo) {
      throw new Error("لم تصل معلومات المجموعة.");
    }

    const botID = String(
      api.getCurrentUserID()
    );

    const adminIDs = (
      targetInfo.adminIDs || []
    ).map(admin =>
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
      `السبب: ${errorMessage(error)}`,
      threadID,
      messageID
    );
  }

  // إعادة التحقق لمنع الاستعادة المتزامنة
  if (backup.busy) {

    return send(
      api,
      "⏳ هذه النسخة قيد الاستعادة بالفعل.",
      threadID,
      messageID
    );
  }

  // ===========================================
  // 2 - قفل النسخة
  // ===========================================

  backup.busy = true;

  const replyIndex = global.client.handleReply.findIndex(
    item =>
      item.messageID === handleReply.messageID &&
      item.name === module.exports.config.name
  );

  if (replyIndex !== -1) {
    global.client.handleReply.splice(replyIndex, 1);
  }

  const results = [];

  function addResult(
    label,
    success,
    attempts,
    details = "",
    error = null
  ) {

    results.push({
      label,
      success,
      attempts,
      details,
      error
    });
  }

  async function execute(label, callback) {

    const result = await retry(callback);

    addResult(
      label,
      result.success,
      result.attempts,
      "",
      result.error || null
    );

    return result;
  }

  try {

    // =========================================
    // إشعار بدء الاستعادة
    // =========================================

    try {

      await send(
        api,
        `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
        `🚀 بدأت استعادة النسخة: ${name}\n\n` +
        `👥 الأعضاء: ${backup.members.length}\n` +
        `📝 الكنيات: ${Object.keys(backup.nicknames || {}).length}\n` +
        `🔄 المحاولات: ${MAX_RETRIES}\n\n` +
        `⏳ قد تستغرق العملية بعض الوقت...`,
        threadID,
        messageID
      );

    } catch (error) {

      console.error(
        "HINA RESTORE NOTICE:",
        error
      );
    }

    // =========================================
    // 3 - استعادة اسم المجموعة
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

      addResult(
        "اسم المجموعة",
        true,
        0,
        "لا يوجد اسم محفوظ"
      );
    }

    // =========================================
    // 4 - استعادة صورة المجموعة
    // =========================================

    if (backup.image) {

      let imageBuffer = null;

      // تحميل الصورة مع إعادة المحاولة
      const downloadResult = await retry(
        async () => {

          imageBuffer = await downloadImage(
            backup.image
          );

          return imageBuffer;
        }
      );

      if (!downloadResult.success) {

        addResult(
          "صورة المجموعة",
          false,
          downloadResult.attempts,
          "فشل تحميل الصورة",
          downloadResult.error
        );

      } else {

        // تغيير الصورة مع إعادة المحاولة
        const imageResult = await retry(
          async () => {

            await callApi(
              api,
              "changeGroupImage",
              [
                Readable.from([imageBuffer]),
                threadID
              ]
            );
          }
        );

        if (imageResult.success) {

          addResult(
            "صورة المجموعة",
            true,
            imageResult.attempts,
            "تم تغيير صورة المجموعة بنجاح"
          );

        } else {

          // ===================================
          // إرسال الصورة عند فشل تغييرها
          // ===================================

          let attachmentSent = false;
          let attachmentError = null;

          const attachmentResult = await retry(
            async () => {

              await sendImageAttachment(
                api,
                imageBuffer,
                threadID,
                `🖼️ صورة المجموعة المحفوظة للنسخة: ${name}\n` +
                `⚠️ تعذر تغيير صورة المجموعة تلقائياً.`
              );

              attachmentSent = true;
            }
          );

          if (!attachmentResult.success) {

            attachmentError =
              attachmentResult.error;
          }

          addResult(
            "صورة المجموعة",
            false,
            imageResult.attempts,
            attachmentSent
              ? "فشل تغيير الصورة، ولكن تم إرسالها كمرفق داخل المجموعة."
              : "فشل تغيير الصورة وإرسالها كمرفق.",
            attachmentSent
              ? imageResult.error
              : `${imageResult.error}\nفشل إرسال المرفق: ${attachmentError}`
          );
        }
      }

    } else {

      addResult(
        "صورة المجموعة",
        true,
        0,
        "لا توجد صورة محفوظة"
      );
    }

    // =========================================
    // 5 - استعادة الأعضاء
    // =========================================

    let existing = new Set(
      (targetInfo.participantIDs || []).map(String)
    );

    const botID = String(
      api.getCurrentUserID()
    );

    let added = 0;
    let alreadyExists = 0;
    let failedMembers = 0;
    let ignoredMembers = 0;

    for (const member of backup.members) {

      const id = String(member);

      if (id === botID) {
        ignoredMembers++;
        continue;
      }

      if (existing.has(id)) {

        alreadyExists++;
        continue;
      }

      const memberResult = await retry(
        async () => {

          // تحديث العضوية قبل كل محاولة
          // لتجنب تكرار إضافة عضو تمت إضافته فعلياً

          const currentMembers = await refreshMembers(
            api,
            threadID
          );

          if (currentMembers.has(id)) {

            existing.add(id);

            return "already_exists";
          }

          await callApi(
            api,
            "addUserToGroup",
            [
              id,
              threadID
            ]
          );

          existing.add(id);

          return "added";
        }
      );

      if (memberResult.success) {

        if (
          memberResult.result === "already_exists"
        ) {

          alreadyExists++;

        } else {

          added++;
        }

      } else {

        failedMembers++;
      }
    }

    // تحديث العضوية بعد الانتهاء
    try {

      existing = await refreshMembers(
        api,
        threadID
      );

    } catch (error) {

      console.error(
        "HINA MEMBERS REFRESH:",
        error
      );
    }

    addResult(
      "الأعضاء",
      failedMembers === 0,
      MAX_RETRIES,
      `تمت الإضافة: ${added}\n` +
      `موجودون مسبقاً: ${alreadyExists}\n` +
      `تخطي: ${ignoredMembers}\n` +
      `فشل: ${failedMembers}`,
      failedMembers
        ? `تعذرت إضافة ${failedMembers} عضواً`
        : null
    );

    // =========================================
    // 6 - استعادة الكنيات
    // =========================================

    let nicknameSuccess = 0;
    let nicknameFailed = 0;
    let nicknameSkipped = 0;

    const nicknameEntries = Object.entries(
      backup.nicknames || {}
    );

    for (const [memberID, nickname] of nicknameEntries) {

      const id = String(memberID);

      if (
        nickname === null ||
        nickname === undefined ||
        nickname === ""
      ) {
        nicknameSkipped++;
        continue;
      }

      if (!existing.has(id)) {

        nicknameSkipped++;
        continue;
      }

      // استخدام ترتيب المعاملات المختبر
      const nicknameResult = await retry(
        async () => {

          await callApi(
            api,
            "changeNickname",
            [
              nickname,
              threadID,
              id
            ]
          );
        }
      );

      if (nicknameResult.success) {

        nicknameSuccess++;

      } else {

        nicknameFailed++;

        console.error(
          `HINA NICKNAME FAILED ${id}:`,
          nicknameResult.error
        );
      }
    }

    addResult(
      "الكنيات",
      nicknameFailed === 0 &&
      nicknameSkipped === 0,
      MAX_RETRIES,
      `نجح: ${nicknameSuccess}\n` +
      `فشل: ${nicknameFailed}\n` +
      `تخطي: ${nicknameSkipped}`,
      nicknameFailed || nicknameSkipped
        ? "لم تتم استعادة جميع الكنيات"
        : null
    );

    // =========================================
    // 7 - التقرير النهائي
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
      }

      if (!result.success && result.error) {

        report +=
          `⚠️ الخطأ: ${result.error}\n`;
      }

      report += "\n";
    }

    report +=
      `━━━━━━━━━━━━━━━━\n` +
      `✅ العمليات الناجحة: ${successful.length}\n` +
      `❌ العمليات الفاشلة: ${failed.length}\n`;

    if (failed.length === 0) {

      delete backups[name];

      report +=
        `\n🎉 اكتملت الاستعادة بنجاح.\n` +
        `🗑️ تم حذف النسخة المؤقتة.`;

    } else {

      report +=
        `\n⚠️ الاستعادة غير مكتملة.\n` +
        `📂 النسخة ما زالت محفوظة في ذاكرة HINA.\n` +
        `يمكنك كتابة "نقل" والمحاولة مجدداً.`;
    }

    return await send(
      api,
      report,
      threadID,
      messageID
    );

  } catch (error) {

    console.error(
      "HINA RECOVERY ERROR:",
      error
    );

    return send(
      api,
      `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
      `❌ حدث خطأ غير متوقع.\n\n` +
      `السبب: ${errorMessage(error)}\n\n` +
      `📂 النسخة ما زالت محفوظة في الذاكرة.`,
      threadID,
      messageID
    );

  } finally {

    // تحرير القفل دائماً
    if (backups[name]) {
      backups[name].busy = false;
    }
  }
};