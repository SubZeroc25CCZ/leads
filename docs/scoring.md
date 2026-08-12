# ניקוד לידים — משקלות הסיגנלים

הציון של ליד = סכום משקלות הסיגנלים שלו, עם תקרה 100.

עוגן מאומת: ליד עם `code_violation` בודד = **15** (נצפה על כל 974 הלידים בייצור).
שאר המשקלות הוגדרו כאן כסטנדרט של הריפו; אם יתגלה שה-merge הפרוס מחשב אחרת —
מיישרים לפי הקוד הפרוס ומעדכנים את הטבלה.

| signal | משקל | רציונל |
|---|---|---|
| `lis_pendens` | 35 | הליך עיקול התחיל — המצוקה מתועדת בבית משפט |
| `pre_foreclosure` | 35 | כנ"ל, שלב מוקדם |
| `probate` | 30 | ירושה — מוטיבציית מכירה גבוהה, לרוב נכס לא רצוי |
| `tax_delinquent` | 25 | חוב מס פתוח — לחץ כספי מתמשך |
| `inherited` | 20 | נכס שהתקבל בירושה (סיגנל רך מ-probate פעיל) |
| `code_violation` | 15 | תיק אכיפה פתוח — הזנחה/קושי תחזוקתי |
| `absentee` | 15 | בעלים גר בכתובת אחרת — משקיע עייף / נכס מוזנח |
| `vacant` | 15 | נכס ריק |
| `divorce` | 15 | אירוע חיים שמאיץ מכירה |
| `tired_landlord` | 10 | משכיר ותיק עם תיקי אכיפה חוזרים |

## מדרגות איכות (למחיר)

| ציון | משמעות | דוגמה |
|---|---|---|
| 15–25 | סיגנל בודד "רך" | code_violation בלבד |
| 30–45 | שני סיגנלים מוצלבים | code_violation + absentee + owner מלא |
| 50–75 | ערימת סיגנלים | tax_delinquent + absentee + code_violation |
| 80+ | מצוקה מתועדת + הצלבות | lis_pendens + tax_delinquent + absentee |

טלפון מאומת ו-TCPA consent הם מכפילי מחיר, לא ציון — הם נרשמים בשדות
`phone` / (עתידי) consent, והקונה משלם לפי הרמה.

## זמינות סיגנלים בפועל (12.08.2026)

- `code_violation` — חי בארבעה מקורות (Lee, Miami-Dade, Orange, Broward/Deerfield).
- `absentee` — חי ל-Miami-Dade דרך העשרת Property Appraiser (mailing ≠ site).
- `tax_delinquent` — **חסום כרגע**: הרשימות הרשמיות של כל 5 המחוזות יושבות על
  Grant Street TaxSys מאחורי Cloudflare challenge שחוסם fetch שרתי. פתרון עתידי:
  headless browser או דאטה ברישיון. חלופה חלקית שאומתה: תוצאות tax deed auctions
  של Broward (broward.deedauction.net) — HTML עם folio וסכומי חוב, בלי כתובת
  (דורש join ל-BCPA).
- `probate`, `lis_pendens`, `pre_foreclosure` — טרם נבנו מקורות; דורשים גישה
  לרשומות בתי משפט / clerk (לרוב מאחורי אותן חסימות).
