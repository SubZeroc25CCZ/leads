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
