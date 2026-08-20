# LeadMachine — חוזה ה-API והמערכת

> קוד הפונקציות חי ב-Vercel (פרויקט leadmachine בצוות Vercel הרלוונטי)
> ולא היה שמור בגיט. מסמך זה מתעד את החוזה כפי שנצפה.

## פריסה
- Frontend+API: Vercel leadmachine — leadmachine-gamma.vercel.app
- DB: Cloudflare D1 leadmachine-db (bce5b2af-1852-4aa0-a084-ecba3d3f3933)
- Cron: יומי ~09:32 UTC -> /api/cron/harvest
- Probe: Vercel leadmachine-probe — fetch/enrich/adapter/buyer-hunt

## Endpoints (מהדשבורד)
- GET /api/leads?county=&min_score=&status= -> leads + stats
- POST /api/ingest {source, rows[]} -> {inserted, merged} (merged = signal-stacking)
- GET /api/cron/harvest [?log=1]
- GET /api/export?... -> CSV
- GET|POST /api/buyers

## חוזה sources (data-driven; מקור חדש = INSERT)
- url_template עם {cutoff_date}; ArcGIS date: DATE '{cutoff_date}'
- field_map JSON (address חובה); signal; dedup לפי address_key.

## מקורות פעילים (12.08.2026)
| name | county | signal |
|---|---|---|
| capecoral_code_open | Lee | code_violation |
| mdc_code_violations | Miami-Dade | code_violation |
| orlando_code_enforcement | Orange | code_violation (Socrata via adapter) |
| deerfield_code_cases | Broward | code_violation |

נפסלו: Duval (GIS נעול), Hillsborough/Tampa (קפוא), Fort Lauderdale (2019).
