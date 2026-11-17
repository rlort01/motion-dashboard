# Motion team dashboard

One page for Motion Property Management Group, Motion Property Preservation and Motion Realty:
the 2026 scorecard, AppFolio + Jobber work orders, billing and utility bill-back checks, and a TV board.

- Sign-in: emailed link, limited to @motionpmg.com, @motionpropertypreservation.com and @motionrealty.com.
- Data: Supabase project `motion-dashboard` (table `datasets`, readable only by signed-in Motion accounts
  through row-level security). This repository holds no business data.
- Refresh: scheduled Claude tasks write to the private `motion-dashboard-data` repo, whose GitHub Action
  loads the data into Supabase.
- TV board: open `…/?company=tv` on the screen and sign in once; it stays signed in and refreshes itself.

Files: `index.html` (page), `styles.css`, `dash.js` (small runtime the page scripts use),
`sc.js`, `app.js`, `ramp.js`, `companies.js` (the dashboard), `main.js` (sign-in and data loading).
