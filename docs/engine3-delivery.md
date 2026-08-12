# מנוע 3 — מסירה וגבייה

## מסירה
GET /api/export?county=&min_score=&status= (text/csv) — המנגנון הקיים.
זרימה: סינון (county/ZIP/min_score/signal) -> CSV ממותג -> סימון delivered (exclusive)
או השארה new (shared).

## תיעוד
טבלת deliveries: buyer_id, lead_ids[], type, price_total, delivered_at, notes.
כדי לא למכור פעמיים ליד exclusive.

## תמחור (scoring.md)
| ציון | מחיר/ליד |
|---|---|
| 15 | $10–20 |
| 30 | $25–40 |
| 50+ | $50–120 |
| +טלפון | x2–3 |
באטץ' ראשון: pay-per-close/הנחת היכרות. exclusive > shared.

## גבייה
Stripe payment link לכל באטץ'. עד אז חשבונית ידנית/Zelle, תיעוד זהה ב-deliveries.

## מוכן, לא פעיל — מופעל כשקונה ראשון אומר "כן".
