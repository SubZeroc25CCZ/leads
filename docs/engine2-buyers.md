# מנוע 2 — ציד קונים ו-outreach

הקונים רשומים ב-public records: מי שקנה נכסי השקעה (ישות תאגידית, נכסים מפוזרים,
טווח flipper) הוא קונה פעיל עם שם וכתובת דיוור.

## שלב א' — prospects
GET /api/buyer-hunt?secret=...&since=2026-01-01&minPrice=60000&maxAvg=1500000&minCount=2
מול PaGISView: מסנן מכירות תאגידיות, מוציא בנקים/עמותות/בנאים/REIT, מקבץ לפי בעלים,
דורש רכישות ברחובות שונים (streets>=3), מסנן ממוצע מחיר.
הרצה 12.08: 30 prospects נכנסו ל-buyers (top: BROOKSVILLE 13, NABA 8, MHR 7).

## שלב ב' — העשרת קשר
Sunbiz (registered agent/officers), אתר/Google/LinkedIn. שמות אמת שנמצאו:
NABA=Esney Diaz, MHR=Maher Ghafir, Barboza=Andres Barboza, Golden Horse=Cristian Parras,
SRJ=Roberto Prieto. רוב ה-prospects הם shell LLCs בלי מייל -> דיוור ישיר.

## שלב ג' — outreach
Inbox: leadmachine@agentmail.to. רצף: פתיח+דגימה -> מעקב -> סגירה
(docs/outreach-templates.md). שום מייל לא נשלח אוטומטית — drafts בלבד, אישור מפורש.

## אינטגרציה
קונה "מעוניין" -> status=active -> מנוע 3. 3+ active -> מנוע 4.
