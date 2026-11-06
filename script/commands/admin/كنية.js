module.exports.config = {
  name: "كنية",
  version: "4.4.0",
  hasPermssion: 0,
  credits: "أبو هريرة",
  description: "عرض أو تغيير أو استعادة كنية عضو",
  commandCategory: "admin",
  usages: "كنية | كنية <الكنية> | كنية استعادة (بالرد)",
  cooldowns: 3
};

module.exports.run = async function ({
  api,
  event,
  args
}) {
  const {
    threadID,
    messageID,
    senderID,
    messageReply
  } = event;

  const DEVELOPER_ID = "61578581225040";

  try {
    // معلومات المجموعة
    const threadInfo = await api.getThreadInfo(threadID);

    if (!threadInfo) {
      return api.sendMessage(
        "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\n❌ تعذر الحصول على معلومات المجموعة.",
        threadID,
        messageID
      );
    }

    // التحقق من الصلاحيات
    const isDeveloper =
      String(senderID) === DEVELOPER_ID;

    const isAdmin =
      Array.isArray(threadInfo.adminIDs) &&
      threadInfo.adminIDs.some(
        admin => String(admin.id) === String(senderID)
      );

    if (!isAdmin && !isDeveloper) {
      return api.sendMessage(
        "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\n⛔ هذا الأمر للأدمن أو المطور فقط!",
        threadID,
        messageID
      );
    }

    // التحقق من الرد
    if (!messageReply || !messageReply.senderID) {
      return api.sendMessage(
        "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\n" +
        "📝 يجب الرد على رسالة العضو.\n\n" +
        "الاستخدام:\n" +
        "• كنية : عرض الكنية\n" +
        "• كنية <الكنية> : تغيير الكنية\n" +
        "• كنية استعادة : استعادة الكنية",
        threadID,
        messageID
      );
    }

    const targetID = String(messageReply.senderID);
    const botID = String(api.getCurrentUserID());

    if (targetID === botID) {
      return api.sendMessage(
        "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\n😅 لا يمكن تغيير كنية البوت!",
        threadID,
        messageID
      );
    }

    // الكنية الحالية
    const currentNickname =
      threadInfo.nicknames?.[targetID] || "";

    const nickname = Array.isArray(args)
      ? args.join(" ").trim()
      : "";

    // ==========================================
    // عرض الكنية
    // ==========================================

    if (!nickname) {
      return api.sendMessage(
        "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\n" +
        "🏷️ الكنية الحالية:\n\n" +
        (currentNickname || "لا توجد كنية"),
        threadID,
        messageID
      );
    }

    // ==========================================
    // استعادة الكنية
    // ==========================================

    if (nickname.toLowerCase() === "استعادة") {

      if (!currentNickname) {
        return api.sendMessage(
          "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\n" +
          "❌ لا توجد كنية حالية لاستعادتها.",
          threadID,
          messageID
        );
      }

      // تسجيل التغيير باعتباره صادراً من البوت
      if (typeof global.HINA_MARK_BOT_CHANGE === "function") {
        global.HINA_MARK_BOT_CHANGE(
          "nickname",
          String(threadID),
          String(targetID)
        );
      }

      // حفظ الكنية قبل حذفها
      const savedNickname = currentNickname;

      // حذف الكنية
      await api.changeNickname(
        "",
        threadID,
        targetID
      );

      // انتظار قصير
      await new Promise(resolve => setTimeout(resolve, 1200));

      // إعادة تطبيق الكنية
      await api.changeNickname(
        savedNickname,
        threadID,
        targetID
      );

      return api.sendMessage(
        "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\n" +
        "✅ تمت استعادة الكنية بنجاح!\n\n" +
        "🏷️ الكنية المستعادة:\n" +
        savedNickname + "\n\n" +
        "🔄 تم حذفها وإعادة تطبيقها.",
        threadID,
        messageID
      );
    }

    // ==========================================
    // تغيير الكنية
    // ==========================================

    if (typeof global.HINA_MARK_BOT_CHANGE === "function") {
      global.HINA_MARK_BOT_CHANGE(
        "nickname",
        String(threadID),
        String(targetID)
      );
    }

    await api.changeNickname(
      nickname,
      threadID,
      targetID
    );

    return api.sendMessage(
      "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\n" +
      "✅ تم تغيير الكنية بنجاح!\n\n" +
      "🏷️ الكنية القديمة:\n" +
      (currentNickname || "لا توجد كنية") +
      "\n\n" +
      "🏷️ الكنية الجديدة:\n" +
      nickname,
      threadID,
      messageID
    );

  } catch (error) {
    console.error(
      "❌ [HINA NICKNAME ERROR]",
      error
    );

    return api.sendMessage(
      "⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌬\n\n" +
      "❌ حدث خطأ أثناء تنفيذ الأمر.\n\n" +
      "تأكد من صلاحيات البوت وأن العضو موجود في المجموعة.",
      threadID,
      messageID
    );
  }
};