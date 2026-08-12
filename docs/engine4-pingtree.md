# מנוע 4 — Ping Tree (מוכן להפעלה, לא פעיל)

> מפעילים רק כשיש 3+ קונים active באותו county/ורטיקל. עם קונה אחד מוכרים ישירות (מנוע 3).

## הרעיון
ליד נכנס -> ping לכל הקונים התואמים -> כל אחד מציע מחיר -> הגבוה מקבל post מלא.

## סכמה (נוצרה ב-D1)
- buyer_filters: buyer_id, vertical, counties[], zips[], min_score, require_signals[],
  max_per_day, bid_per_lead, exclusive, active.
- lead_offers: lead_id, round_ref, created_at.
- lead_bids: offer_id, buyer_id, bid, won.

## לוגיקה (/api/distribute עתידי)
לכל ליד new: matching = filters תואמים county/zip/min_score/require_signals;
offer + bids (fixed-bid מהפילטר); winner = הגבוה; deliveries + status=delivered.
מודלים: fixed-bid (ראשון), real-time ping-post (webhook לקונה).

## סטטוס
- ✅ סכמה קיימת ב-D1.
- ⬜ endpoint /api/distribute — כשיהיו 3+ קונים active.
- ⬜ מילוי buyer_filters — כשקונים סוגרים.
