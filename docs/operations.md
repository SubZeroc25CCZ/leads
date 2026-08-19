# תפעול — אוטומציה מלאה

המערכת מריצה את עצמה. שלוש לולאות אוטומטיות מכסות את הפייפליין. **outreach קר
מושהה** (ראו "מדיניות שליחה") עד תבנית תואמת CAN-SPAM; מיילים טרנזקציוניים
(מענה לפניות, מסירות אחרי תשלום, מילוי בקשות sample מהאתר) נשלחים אוטומטית.

## לולאה 1 — קציר (Vercel cron, server-side, ~09:32 UTC יומי)

`/api/cron/harvest` בפרויקט `leadmachine` רץ ללא Claude: עובר על כל שורה
פעילה ב-`sources`, מוריד מאז `{cutoff_date}`, מנרמל כתובת → `address_key`,
insert/merge, ורושם ל-`harvest_log`. מקורות שאינם ArcGIS (Orlando) עוברים דרך
ה-adapter ב-`leadmachine-probe`.

**תקלה פתוחה (12.08.2026):** הריצה הראשונה עם 4 מקורות החזירה **500** בלי לרשום
כלום ל-`harvest_log`. כל 4 ה-endpoints נבדקו ותקינים — הבאג בקוד הפרוס, שאינו
בגיט ואי-אפשר להוריד אותו בכלים מכאן. **פעולה נדרשת (בעלים):** Vercel dashboard →
project `leadmachine` → Deployment → לשונית **Source** → העתקת קבצי `api/*` לריפו.
עד אז לולאה 2 מריצה את הקציר ידנית כ-fallback.

### fallback קציר ידני (מוכח 12.08 — 969 לידים)

לכל מקור פעיל: `GET /api/harvest-fetch?secret=...&county=<county>&url=<url_template
עם cutoff>&map=<field_map>` (בפרויקט `leadmachine-probe`, בגיט) מחזיר שורות
מנורמלות אחרי סינון (בלי NO ADDRESS/EXEMPT/טווחים, dedup בתוך ה-batch); ואז
upsert ל-D1: `INSERT ... WHERE NOT EXISTS (address_key)` ורישום `harvest_log`
עם note `manual run`.

## לולאה 2 — מחזור יומי מלא (Claude Routine, יומי ~10:04 UTC)

טריגר `trig_01KsPUKJpqodbb4zcYF34shJ` קשור ל-**סשן הפרויקט הקבוע**
(session_01QMXJBqPpz3VSwCWqu6f4ws) — גישה מלאה ל-MCP. מבצע: בדיקת קציר (+
fallback ידני אם ה-cron נפל), QA כתובות, העשרת Miami-Dade, גילוי קונים (ימי ב'),
מחקר אנשי קשר (בלי שליחה קרה), בדיקת תשלומים + מסירה אוטומטית, תיבה, רענון
Artifact, דחיפת קוד.

## לולאה 3 — sweep שעתי (Claude Routine, כל שעה)

טריגר `trig_01AVAWUoBZphijSdRXa3NAyQ`: מושך שורות `LEAD_CAPTURE` מ-runtime logs
של `leadmachine-buyers` (טופס האתר; ל-Vercel אין credentials ל-D1, הלוג הוא
המחסן הזמני — retention ~שעה) ומזרים ל-`buyer_leads`, ממלא בקשות sample.

## מדיניות שליחה (עודכן 12.08.2026)

- **outreach קר מושהה** עד: (1) תבנית עם כתובת דואר פיזית + לינק/מנגנון הסרה
  (דרישת CAN-SPAM — חסר: כתובת פיזית מהבעלים); (2) רצוי דומיין שליחה ייעודי.
- **אין להשתמש במיילים שמקורם MLS / מדריכי מתווכים** (תנאי MLS/NAR אוסרים
  קציר ל-solicitation). רק אתר החברה / Sunbiz / Google Business.
- טרנזקציוני מותר: מענה לפניות, sample לפי בקשה מהטופס, מסירות אחרי תשלום —
  תמיד עם שורת reply-STOP.
- הסרה: 'DO-NOT-EMAIL' ב-buyers.notes, נבדק לפני כל שליחה.

## dedupe אטומי (עודכן 12.08.2026)

`deliveries.dedupe_key` עם אינדקס UNIQUE. לפני **כל** שליחה: INSERT עם
`dedupe_key` = `thread:<id>` / `sample:<email>` / `stripe:<session>`. אם
`changes=0` — תהליך אחר כבר טיפל, לא שולחים. רישום קודם, שליחה אחר-כך.
(מחליף check-then-act שהיה race בין הלולאות.)
ב-buyers: אינדקס unique חלקי `uq_buyers_email` על `lower(email)` (רק לשורות עם
מייל). סטטוסים: `prospect` / `contacted` / `no_contact` (אין מייל לגיטימי) —
דוחות סופרים רק prospect+contacted כפייפליין.

## נרמול כתובות — strip-after-zip (נוסף 12.08.2026)

השדה `USER_Site_Address` של Deerfield חוזר לפעמים עם מספר היחידה כפול אחרי המיקוד
(`... DEERFIELD BEACH, FL 33064 B7`, `... FL 33442 #227`). זו דאטה של העירייה, לא באג
אצלנו — אבל היא מייצרת `address_key` שונה לאותו נכס ושוברת dedup. `cleanAddr`
ב-`harvest-fetch.js` חותך עכשיו כל דבר שאחרי `FL <5 ספרות>`. 28 שורות קיימות תוקנו
ב-D1 (כתובת + `address_key`), אומת: 1,943 שורות / 1,943 מפתחות ייחודיים.

**✅ נפרס 13.08.2026:** `leadmachine-probe` נפרס מחדש מהגיט (deployment
`dpl_Knzq7MeauKEEY5M2TxgDANuWU5xk`, 5 פונקציות, alias `leadmachine-probe.vercel.app`),
וה-endpoint החי מחזיר עכשיו כתובות חתוכות — אומת מול Deerfield לפני ואחרי:
`1531 NW 45 ST, UNIT B7, ... FL 33064 B7` → `... FL 33064`. מספר היחידה נשמר במקומו
בתוך הכתובת, כך שיחידות שונות עדיין מקבלות `address_key` נפרד (לא קורס לנכס אחד).
D1 נקי: 1,943 שורות / 1,943 מפתחות / 0 כתובות עם זנב אחרי המיקוד.
**העקיפה בלולאה 2 (נרמול ידני לפני ה-upsert) כבר לא נדרשת.**

## ⛔ אזהרה: שני פרויקטי Vercel מחוברים לאותו ריפו (13.08.2026)

`leadmachine-buyers` **וגם** `leadmachine-probe` מחוברים ל-GitHub על אותו ריפו ואותו
ענף. כל `git push` פורס **את שניהם** מ-root של הריפו. זה הפיל את שניהם ב-13.08:

- **האתר** החזיר 404 על כל נתיב (כולל `/api/lead`) כי ב-root אין `index.html`.
  תוקן: `vercel.json` עם `outputDirectory: "site"` + העברת הפונקציה ל-`api/lead.js`
  ב-root (זה הפריסה הסטנדרטית של Vercel). האתר עובד.
- **ה-probe** נשבר מאותה סיבה — הפונקציות שלו יושבות ב-`probe/api/`, לא ב-root.
  אחרי שהעברתי את `lead.js` ל-root, ה-probe התחיל להגיש את `/api/lead` במקום
  `/api/probe`. שוחזר ב-**פריסה ידנית** (`deploy_to_vercel`, 5 פונקציות מ-`probe/api/`).

**המשמעות: ה-probe חי כרגע על פריסה ידנית שאינה מגיט. כל push הבא ידרוס אותו וישבור
שוב את `/api/adapter` (מקור Orlando), `/api/harvest-fetch` (fallback הקציר),
`/api/mdc-enrich` ו-`/api/buyer-hunt`.**

**פעולת בעלים נדרשת לפני ה-push הבא** — אחת מהשתיים בדשבורד Vercel:
1. `leadmachine-probe` → Settings → Git → **Disconnect** (ואז לפרוס אותו ידנית בלבד); או
2. `leadmachine-probe` → Settings → Build → **Root Directory = `probe`**
   (ואז גם לשקול `leadmachine-buyers` → Root Directory = `site`, ולהחזיר את
   `lead.js` ל-`site/api/`).

עד אז: אחרי כל push חובה לפרוס את ה-probe מחדש ידנית ולאמת
`/api/probe`, `/api/adapter`, `/api/harvest-fetch`.

**הערה נוספת:** הריפו **ציבורי** וה-secret של ה-probe מוטמע בקוד — כלומר
`/api/probe` הוא בפועל fetch-proxy פתוח לכל מי שקורא את הריפו. שווה רוטציה של
הסוד + הפיכת הריפו לפרטי.

## ⛔ הקציר נפל — cron מחזיר 500 (16.08.2026)

`/api/cron/harvest` בפרויקט `leadmachine` מחזיר **500 בכל 20 ההרצות מאז
2026-08-15T23:29Z** (הריצה המוצלחת האחרונה). הפריסה לא השתנתה מ-13.08, ולכן זו
תקלת סביבה/הרשאות ולא באג חדש בקוד. גם `/api/cron/tick` (דייג'סט + רצף ה-outreach)
מחזיר 500. **הקוד של הפרויקט הזה יושב בריפו פרטי אחר (`SubZeroc25CCZ/leadmachine`)
שאינו בהישג הסשן הזה — האבחון הוא פעולת בעלים.**

עקיפה שבוצעה: ה-probe נפרס מחדש ידנית (שוב) והקציר הורץ ידנית דרכו — ארבעת
המקורות החזירו 200, **0 שורות חדשות**. זה תוצאה צפויה: גם ה-cron רשם `inserted=0`
בכל הרצה בשעות שלפני הנפילה, וסוף-שבוע = אין תיקים חדשים. כלומר 11 שעות ההשבתה
לא עלו בדאטה.

**רמז לאבחון:** אותו חלון זמן מלווה ב-403 חולפים מ-Cloudflare D1 ("account is not
valid or is not authorized") גם בסשן הזה — נמחקים בניסיון חוזר. ה-cron לא מנסה שוב.

## ⚠️ סתירת מדיניות outreach — שתי מערכות, שתי מדיניות (16.08.2026)

בטבלת `app_settings` יש `outbound_ramp_start = 2026-08-13`: הפריסה השנייה
**פתחה outreach קר** עם ramp של 5 ליום, בניגוד להשהיה שבמסמך הזה (CAN-SPAM, חסרה
כתובת דואר פיזית). בפועל עוד לא נשלח כלום — `email_log` מכיל שתי שורות בלבד
(portal magic links מ-13.08) — **והסיבה היחידה היא ש-`/api/cron/tick` שבור.**
כשהוא יתוקן, המערכת ההיא תתחיל לשלוח. שתי המערכות כותבות לאותו `buyers`.

## נרמול כתובות — placeholders (עודכן 16.08.2026)

Miami-Dade מחזיר גם `NOT AVAILABLE` בשדה הכתובת, לא רק `NO ADDRESS` /
`EXEMPT FROM PUBLIC RECORDS`. שורה כזו כבר הגיעה ל-D1 כליד (id 2778, סומנה
`invalid`). `harvest-fetch.js` משתמש עכשיו ב-`PLACEHOLDERS` Set במקום שתי
השוואות, ואומת חי: 5 שורות `NOT AVAILABLE` נשאבו, 5 דולגו, 0 הוחזרו.

## Artifact הסטטוס

מקור ה-Artifact הפנימי (עברית, 4 לשוניות) שמור בריפו ב-`dashboard/leadmachine-artifact.html`
ומתפרסם ל-URL הקבוע `claude.ai/code/artifact/4bc0d089-cfbc-4801-b8a7-bad768190527`.
**תמיד לפרסם עם `url=` של ה-Artifact הקיים** — פרסום בלי זה יוצר Artifact חדש.
לפני עדכון מסשן שלא פרסם אותו: WebFetch ל-URL, מיזוג, ואז פרסום.

## נקודות תורפה ידועות

| סיכון | מיטיגציה |
|---|---|
| הסשן הקבוע נרקלם (מיכל ephemeral) | טריגרים קשורי-סשן מקימים אותו מחדש בכל ריצה |
| קוד ה-harvester הפרוס לא בגיט + cron מחזיר 500 | fallback ידני בלולאה 2 (harvest-fetch בגיט); שחזור מקור = פעולת בעלים בדשבורד Vercel |
| PaGISView מתעדכן שבועי (שבת) | לידים חדשים מחכים עד שבוע להעשרה — הלולאה מנסה כל יום |
| ה-secret של ה-probe מוטמע בקוד | סיכון נמוך (קריאת דאטה ציבורית); רוטציה = החלפת קבוע + redeploy |
| אין enrichment ל-Orange (address בלבד) | Deerfield מביא owner/zip מהמקור; Orange enrichment טרם נבנה |
| retention של runtime logs ~שעה | sweep שעתי; שדרוג עתידי: CF_API_TOKEN ב-env של leadmachine-buyers לכתיבה ישירה |
| כיסוי בפועל: 2 counties + 2 ערים | הניסוח באתר תוקן ל-Miami-Dade County · Lee County · City of Orlando · City of Deerfield Beach |

## הפעלה/כיבוי

- להשבית זמנית: `update_trigger enabled=false` על הטריגר הרלוונטי.
- לשנות שעה/תדירות: `update_trigger cron_expression`.
- הקציר (לולאה 1) נשלט מ-Vercel (פרויקט `leadmachine`), לא מכאן.

## תקלות אימות פתוחות (19.08.2026)

שלוש תקלות הרשאה נפרדות פוגעות בשלושה מסלולים שונים, וכולן דורשות פעולת בעלים:

1. **`/api/lead` באתר הקונים מאבד כתיבה ל-D1.** מ-18.08 23:17Z כל קליטת טופס
   מלווה ב-`[api/lead] D1 write failed, captured via log: D1 query failed:
   Authentication error`. הליד עדיין נרשם בשורת `LEAD_CAPTURE` ולכן ה-sweep
   השעתי מציל אותו — אבל ה-retention של הלוג הוא ~שעה, וכל קליטה שתיפול בין
   שתי סריקות תאבד לחלוטין. אותו סימפטום (auth) כמו ה-cron השבור בפרויקט
   `leadmachine`, ולכן חשוד כטוקן Cloudflare אחד שפג.
2. **Stripe MCP מחזיר `requires re-authorization (token expired)`** מ-08:45Z.
   לולאת התשלומים (כל 4 שעות) והשלב 5 בריצה היומית **עיוורים** לחלוטין: לא
   ניתן לדעת אם מישהו שילם, וקנייה תישאר ללא מסירה. הסשן לא-אינטראקטיבי ולכן
   אי אפשר להריץ כאן OAuth — צריך לחבר מחדש את Stripe בהגדרות ה-connectors
   ב-claude.ai.
3. **`leadmachine@agentmail.to` לא נראה ל-API** מ-13.08 (רק שתי תיבות
   `asaf-63xx@` אוטומטיות). כל שליחה — כולל מסירה אחרי תשלום — חסומה.

עד שאלה ייפתרו, הצינור אוסף לידים אבל אינו יכול לגבות או למסור.
