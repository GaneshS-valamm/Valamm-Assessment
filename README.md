# Role-Based Recruitment Assessment Application

Admin console + candidate assessment portal for four enterprise hiring roles. The admin attaches
each candidate's resume, the candidate reviews it and declares interest in the role, and only then
is the question paper released.
FastAPI + SQLAlchemy backend, React/Vite/TypeScript/Tailwind frontend, PostgreSQL (SQLite fallback).

---

## 1. Quick start (Windows PowerShell)

Two terminals, from `C:\Users\Admin\Desktop\Assesment`.

### Terminal 1 — backend (port 8000)

```powershell
cd C:\Users\Admin\Desktop\Assesment\backend
python -m venv .venv                      # first time only
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt            # first time only
python -m app.seed                         # creates tables + seeds roles/papers/admin
python -m uvicorn app.main:app --reload --port 8000
```

### Terminal 2 — frontend (port 5173)

```powershell
cd C:\Users\Admin\Desktop\Assesment\frontend
npm install                                # first time only
npm run dev
```

Then open **http://localhost:5173/login**

> If `Activate.ps1` is blocked by execution policy, either run
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` first, or skip activation and call
> `.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000` directly.

### Admin login

| Field | Value |
| --- | --- |
| URL | http://localhost:5173/login |
| User ID | `admin` |
| Password | `Admin@12345` |

The password is **not** stored anywhere in the code — `.env` holds only the bcrypt hash
(`ADMIN_PASSWORD_HASH`). To change it:

```powershell
cd C:\Users\Admin\Desktop\Assesment\backend
.\.venv\Scripts\python.exe -c "import bcrypt;print(bcrypt.hashpw(b'YourNewPassword',bcrypt.gensalt()).decode())"
# paste the result into ADMIN_PASSWORD_HASH in .env, then restart the backend
```

---

## 2. Database

`DATABASE_URL` in `.env` controls everything. **Empty = SQLite** at `backend/assessment.db`
(zero setup — this is what runs out of the box).

### Switching to the Render PostgreSQL instance

The Render service is `dpg-dat17kp7lnhs73b8btj0-a`. Render does not expose the password through the
service ID, so copy the **External Database URL** from the Render dashboard
(*Dashboard → your Postgres instance → Connections → External Database URL*) into `.env`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@dpg-dat17kp7lnhs73b8btj0-a.<region>-postgres.render.com/DBNAME?sslmode=require
```

Then create the schema and seed it:

```powershell
cd C:\Users\Admin\Desktop\Assesment\backend
.\.venv\Scripts\python.exe -m app.seed
```

`postgres://` and `postgresql://` URLs are both accepted and rewritten onto the psycopg 3 driver
automatically. Local Postgres works the same way:
`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/assessment_db`

Check which database is live at any time: <http://localhost:8000/api/health>

---

## 3. Testing a candidate assessment end to end

1. Log in at http://localhost:5173/login
2. **Generate Assessment** → enter a name and email, pick one of the four roles, click
   **Generate Assessment Link**
3. Click **Copy Link** (or **Open ↗**). The link looks like
   `http://localhost:5173/assessment/<token>`
4. **Attach the candidate's resume** on the same page (*Attach Resume*), or later from the
   **Candidates / Assessments** table's *Resume* column. PDF or DOCX, up to 10 MB
5. Open the assessment link in a **different browser or an incognito window** (the candidate needs
   no login)
6. The candidate sees **Step 1 - Review your resume**: the resume you attached, previewed inline
   for PDFs, with *Download*, *Upload a New Version* and *This resume is correct*. They must either
   confirm it or replace it
7. Then **Step 2 - Confirm your interest**: *"Would you like to go ahead with the &lt;role&gt; role
   and take the assessment?"*
   - **Yes** -> *Start Assessment* unlocks and the question paper is served
   - **No** -> a confirmation dialog, then the page shows *"Thank you for your response"* and the
     assessment is permanently closed for that link
8. In the admin console, open **Resumes**. If the candidate uploaded a replacement it appears here
   (polled every 10 s, sidebar badge every 15 s) tagged **Candidate** with *updated by candidate*,
   and the *Candidate Interest* column shows their yes/no. Click **View Resume** to preview,
   download, and mark **Reviewed** / **Shortlisted**
9. The candidate answers the 4 multiple-choice and 4 written questions (refresh mid-way - answers
   and resume both come back from the database), then **Submit Assessment**. Reopening the link now
   shows the submitted state and the locked resume
10. **Candidates / Assessments** -> status is `Submitted` with the objective score -> **View
    Result**. Enter marks and feedback per written answer and **Save Evaluation**; the overall score
    and percentage stay **Pending Evaluation** until every subjective answer is marked. The
    candidate's resume is linked from the same page

---

## 4. Project layout

```
Assesment/
├── .env                     # real secrets (gitignored)
├── .env.example             # template
├── README.md
├── backend/
│   ├── requirements.txt
│   ├── assessment.db        # SQLite fallback (created at runtime)
│   ├── clear_assessments.py # maintenance: wipe candidate data (keeps roles/papers/admin)
│   ├── storage/resumes/     # uploaded resumes (gitignored, NOT served publicly)
│   ├── question_bank/       # question papers as editable JSON
│   │   ├── role1_enterprise_sales_manager_agentic_ai.json
│   │   ├── role2_aws_partner_operations_marketplace.json
│   │   ├── role3_sdr_enterprise_sales.json
│   │   └── role4_account_manager_enterprise_sales.json
│   └── app/
│       ├── main.py          # FastAPI app, CORS, error handling, startup seed
│       ├── config.py        # env-driven settings
│       ├── database.py      # engine/session, automatic schema creation
│       ├── models.py        # 9 tables with FKs, unique constraints, indexes
│       ├── schemas.py       # Pydantic I/O contracts (UTC timestamp serialisation)
│       ├── security.py      # bcrypt, JWT, token generation/hashing, rate limiting
│       ├── dependencies.py  # admin auth dependency
│       ├── seed.py          # idempotent init + seed + answer-key validation
│       ├── routes/          # auth, roles, question_papers, assessments, candidate,
│       │                    #   evaluations, resumes
│       └── services/        # assessment_service, scoring_service, token_service,
│                            #   resume_service, storage_service (pluggable file storage)
└── frontend/
    ├── package.json, vite.config.ts, tailwind.config.js, tsconfig.json, index.html
    └── src/
        ├── App.tsx, main.tsx, index.css, vite-env.d.ts
        ├── types/index.ts
        ├── services/api.ts
        ├── components/ui.tsx
        ├── layouts/AdminLayout.tsx
        └── pages/  Login, Dashboard, GenerateAssessment, Candidates, Resumes,
                    QuestionPapers, AssessmentResults, CandidateAssessment
```

---

## 5. Database schema

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `admin_users` | admin accounts | unique `user_id`, bcrypt `password_hash` |
| `roles` | the four hiring roles | unique `role_name` |
| `question_papers` | versioned papers per role | unique (`role_id`, `version`) |
| `questions` | objective + subjective questions | indexed (`question_paper_id`, `question_order`) |
| `question_options` | MCQ options + answer key | unique (`question_id`, `option_order`) |
| `assessments` | one per candidate/link (plus `resume_confirmed_at`, `interest_response`, `interest_responded_at`) | unique `unique_token_hash`; indexes on `role_id`, `status`, `candidate_email`, `created_at` |
| `assessment_answers` | autosaved drafts + final answers | unique (`assessment_id`, `question_id`) |
| `assessment_evaluations` | subjective marks + feedback | unique (`assessment_id`, `question_id`), `awarded_marks >= 0` |
| `candidate_resumes` | resume metadata + storage key (one row per version, with `uploaded_by_type` / `uploaded_by_admin_id`) | unique (`assessment_id`, `version`), unique `storage_key`, `file_size > 0`; indexes on (`assessment_id`, `is_current`), `resume_status`, `uploaded_at`, `candidate_email` |

Schema is created automatically on first start. New **tables** come from `create_all`; new
**columns** on tables that already exist are applied by `migrate_columns()` in `app/seed.py`, which
runs on every start and is idempotent. So **no manual migration is needed** — run
`python -m app.seed` (or just start the backend) and it prints each column it adds:

```
[migrate] assessments.resume_confirmed_at added
[migrate] assessments.interest_response added
[migrate] assessments.interest_responded_at added
[migrate] candidate_resumes.uploaded_by_type added
[migrate] candidate_resumes.uploaded_by_admin_id added
```

Existing rows are untouched and get the column defaults (`interest_response = 'PENDING'`,
`uploaded_by_type = 'CANDIDATE'`). Timestamps are stored in UTC and serialised with an explicit `+00:00` offset; the browser
renders them in local time.

Resume **binaries are never stored in the database** — only metadata plus an opaque `storage_key`.
Replacing a resume inserts a new version row and flips `is_current`; nothing is overwritten or
deleted, and submission sets `is_locked` on every version of that assessment's resume.

---

## 6. API endpoints

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/auth/login` | public (rate-limited: 10/min/IP) |
| POST | `/api/auth/logout` | admin |
| GET | `/api/auth/me` | admin |
| GET | `/api/roles` | public |
| GET | `/api/admin/stats` | admin |
| GET | `/api/admin/question-papers` | admin |
| GET | `/api/admin/question-papers/{paper_id}` | admin |
| POST | `/api/admin/question-papers` | admin |
| POST | `/api/admin/questions` | admin |
| POST | `/api/admin/assessments` | admin |
| GET | `/api/admin/assessments` | admin (search, filters, sort, pagination) |
| GET | `/api/admin/assessments/{id}` | admin |
| GET | `/api/admin/assessments/{id}/results` | admin |
| PUT | `/api/admin/assessments/{id}/evaluations/{question_id}` | admin |
| POST | `/api/admin/assessments/{id}/evaluate` | admin |
| GET | `/api/assessments/{token}` | candidate token |
| POST | `/api/assessments/{token}/start` | candidate token |
| GET | `/api/assessments/{token}/questions` | candidate token |
| PUT | `/api/assessments/{token}/answers/{question_id}` | candidate token |
| POST | `/api/assessments/{token}/submit` | candidate token |
| POST | `/api/assessments/{token}/resume` | candidate token (upload/replace own resume) |
| GET | `/api/assessments/{token}/resume/download` | candidate token (view/download own resume) |
| POST | `/api/assessments/{token}/resume/confirm` | candidate token (resume reviewed, accepted as-is) |
| POST | `/api/assessments/{token}/interest` | candidate token (`{"interested": true\|false}`) |
| POST | `/api/admin/assessments/{assessment_id}/resume` | admin (attach a resume for the candidate) |
| GET | `/api/admin/resumes` | admin (search, filters, pagination, `new_count`) |
| GET | `/api/admin/resumes/unreviewed-count` | admin (badge polling) |
| GET | `/api/admin/resumes/{resume_id}` | admin (metadata + assessment + version history) |
| GET | `/api/admin/resumes/{resume_id}/download` | admin (`?disposition=inline` for preview) |
| PUT | `/api/admin/resumes/{resume_id}/status` | admin (NEW / REVIEWED / SHORTLISTED) |
| GET | `/api/health` | public |

Interactive docs: <http://localhost:8000/docs>

---

## 7. Security notes

* Admin passwords: bcrypt. The plaintext never touches the database or the frontend.
* Assessment tokens: `secrets.token_urlsafe(48)`. Lookup is by HMAC-SHA256 hash keyed with
  `JWT_SECRET` — the raw token is never stored in plaintext. A separately keyed, reversible
  encryption of the token is stored so the admin table can re-display the link; decryption is
  impossible without `JWT_SECRET`.
* Candidate APIs never serialise `is_correct` or `evaluation_criteria` (verified by test).
* The role, question paper and marks are always read from the assessment row — never from a client
  parameter. Posting another candidate's `question_id` returns 404.
* Submitted assessments reject answer changes (409) and duplicate submissions (409).
* Admin JWTs are required on every `/api/admin/*` route; a 401 clears the session client-side.
* Unhandled exceptions return a generic message — no stack traces or SQL reach the client.
* Login is rate-limited per IP; candidate token endpoints are rate-limited per IP+token
  (resume uploads: 20 per 5 minutes per IP+token).
* Resumes have **no public URL**. Files live in `backend/storage/resumes/` — outside everything Vite
  serves — and reach the admin only through the authenticated download endpoint, which the frontend
  turns into a short-lived blob URL. `storage_key` is never sent to any client.
* Uploads are validated on **content, not extension**: PDFs must start with `%PDF-`, DOCX must be a
  real zip containing `word/document.xml`. A renamed `.exe` or `.txt` is rejected.
* Stored filenames are server-generated (`resumes/YYYY/MM/a{id}-v{n}-{16 random bytes}.ext`). The
  original filename is kept for display/download only and is never used as a filesystem path.
* A candidate can only read or attach a resume for the assessment their own token resolves to;
  the candidate download endpoint resolves the file from the token, never from an id.
* The question paper is released only when all three gates pass on the backend: a resume exists,
  the candidate has reviewed it, and `interest_response = INTERESTED`. `GET /questions` and
  `POST /start` both enforce this, so it cannot be bypassed from the frontend.
* A `NOT_INTERESTED` response is final — attempting to flip it back returns 409.

---

## 8. Candidate pre-assessment flow

```
admin generates link  ->  admin attaches resume  ->  candidate opens link
                                                          |
                                      Step 1: review the resume on file
                                      (confirm as-is, or upload a new version)
                                                          |
                                      Step 2: "go ahead with this role?"
                                            /                        \
                                       Yes                            No
                                        |                              |
                             question paper released      "Thank you for your response"
                                        |                     assessment closed
                              answers -> submit                  (final, 409 on retry)
```

State lives on the assessment row: `resume_confirmed_at`, `interest_response`
(`PENDING` / `INTERESTED` / `NOT_INTERESTED`) and `interest_responded_at`. Every resume version
records `uploaded_by_type` (`ADMIN` or `CANDIDATE`), so the admin can see at a glance whether the
candidate replaced what was sent to them.

Set `RESUME_REQUIRED_BEFORE_START=false` in `.env` to skip the resume and review gates; the interest
gate always applies.

If the admin has not attached a resume, the candidate is told so and may upload one themselves
rather than being blocked.

---

## 9. Resume storage

File storage is deliberately separate from the database and from any specific provider.

`backend/app/services/storage_service.py` defines the `ResumeStorage` contract
(`save` / `load` / `exists`) plus a `LocalDiskStorage` implementation, selected by
`RESUME_STORAGE_BACKEND`:

```env
RESUME_STORAGE_BACKEND=local      # only backend shipped today
RESUME_STORAGE_DIR=storage/resumes
MAX_RESUME_SIZE_MB=10
RESUME_REQUIRED_BEFORE_START=true # set false to make the resume optional
```

To move to Supabase Storage, S3 or another private object store later: implement `ResumeStorage`,
register it in `get_storage()`, and set `RESUME_STORAGE_BACKEND`. Nothing in the candidate or admin
workflow changes — the database only ever holds the `storage_key`.

> **Persistence warning.** `local` writes to the backend's own disk. That is fine for development
> and for a machine with a persistent volume, but on an ephemeral host (Render free web services,
> most container platforms, any redeploy that rebuilds the filesystem) **those files are lost while
> the database rows survive** — the download endpoint then returns `410 Gone` with a message saying
> so. For production, configure persistent object storage, or mount a durable volume at
> `RESUME_STORAGE_DIR` and back it up.

---

## 10. Question papers

32 questions total — 8 per role (4 objective × 5 marks, 4 subjective × 20 marks = 100 marks/paper).
Source of truth: the JSON files in `backend/question_bank/`.

* **Editing before first run:** change the JSON, then `python -m app.seed`.
* **Changing a role's questions after links have been sent:** create a new version rather than
  editing v1 — `POST /api/admin/question-papers` then `POST /api/admin/questions`. New assessments
  pick up the new active version; assessments already generated stay pinned to the version they were
  created with, so a candidate's paper never changes underneath them.
* **Viewing papers and answer keys:** admin → *Question Papers* → "Show answer keys".

---

## 11. Test results

All six acceptance workflows were executed against the running application:

| Test | Result |
| --- | --- |
| 1 — Admin login | Pass. Valid login issues a JWT; wrong password → 401 `Invalid User ID or password.`; `/api/admin/*` without a token → 401; 11th bad login in a minute → 429 |
| 2 — Generate four assessments | Pass. One per role, four distinct tokens, each pinned to paper v1 with 8 questions; durations 75/60/45/60 min honoured |
| 3 — Candidate question papers | Pass. Correct name and role shown; 4 objective + 4 subjective in order 1–8; no question id shared between roles; responses contain no `is_correct` / `evaluation_criteria` |
| 4 — Autosave and submission | Pass. 8/8 answers persisted, restored byte-for-byte after re-fetch (newlines and code indentation intact); submit → `SUBMITTED`; second submit → 409; post-submit edit → 409; reopening the link shows the submitted state |
| 5 — Admin results | Pass. Objective auto-scored 15/20 (3 of 4 correct); selected vs. correct option shown per question; full subjective text shown; evaluations saved and re-read; final score stayed `Pending Evaluation` until all four were marked, then resolved to 78/100 = 78% |
| 6 — Persistence | Pass. After stopping and restarting the backend, all assessments, links, answers, timestamps and evaluations were still present and correct |

### Admin-upload / review / interest flow (30/30 checks)

| Check | Result |
| --- | --- |
| Admin attaches a resume | Pass (201, tagged `ADMIN`) |
| Admin upload requires auth | Pass (401 without a token) |
| Candidate sees the admin's resume | Pass (`uploaded_by_type: ADMIN`, correct filename/version) |
| Candidate can read their own resume | Pass (200, `%PDF-` intact, token-scoped) |
| Questions blocked before review | Pass (412 "review the resume on file…") |
| Candidate confirms the resume | Pass (`resume_confirmed_at` set) |
| Questions blocked until interest answered | Pass (412 "confirm whether you would like to proceed…") |
| Candidate answers **Yes** | Pass -> questions served, start succeeds |
| Candidate answers **No** | Pass -> questions 403, start 403, thank-you screen shown |
| Declined response is final | Pass (409 on attempting to flip back to interested) |
| Candidate replaces the resume | Pass (v2 tagged `CANDIDATE`; admin original kept as v1) |
| Admin panel reflects the candidate's version | Pass (`resume_valid.docx` v2, *updated by candidate*) |
| Admin sees the interest response | Pass (on both the resumes list and the assessments list) |
| Existing behaviour intact | Pass (no answer-key leak, submit, resume lock, 409 on locked replace, objective 15/20) |

### Resume feature (30/30 checks, full workflow)

| Check | Result |
| --- | --- |
| Valid PDF upload | Pass (201, stored, listed) |
| Valid DOCX upload | Pass (201, correct content type) |
| Invalid type rejected | Pass. `.txt` → 400 "Only PDF and DOCX resumes are accepted" |
| Fake file rejected on content | Pass. Plain text named `.pdf` and an `MZ` executable named `.pdf` → 400 |
| Oversized file rejected | Pass. 11 MB against a 10 MB limit → 413 |
| Resume mandatory before start | Pass. `POST /start` and `GET /questions` → 412 until a resume exists, is reviewed, and interest is confirmed |
| Correct candidate/role association | Pass (assessment id, candidate, role all match) |
| Replace before submission | Pass. New version row created, v1 retained in history |
| Survives refresh / reopen | Pass (returned from the database on reload) |
| Locked after submission | Pass. `is_locked=true`; replacement attempt → 409 |
| Cross-candidate isolation | Pass. Bogus token → 404; one candidate's upload never touches another's record |
| Admin list, search, filters | Pass (name/email/filename search; role, resume-status, assessment-status filters; history toggle) |
| Notification badge | Pass. `new_count` tracked on both the list and the dedicated endpoint, and mirrored in dashboard stats |
| Admin download + inline preview | Pass. Bytes intact (`%PDF-`, `PK\x03\x04`), correct `Content-Disposition` |
| Auth enforced | Pass. All four admin resume endpoints → 401 without a token |
| Mark Reviewed / Shortlisted | Pass. Status, `reviewed_at` and `reviewed_by` recorded; invalid status → 422 |
| Survives backend restart | Pass. Rows and files both intact; re-download returned identical bytes |
| Storage not publicly served | Pass. `http://localhost:5173/storage/...` returns the SPA's `index.html`, not file bytes |
| Existing workflow unaffected | Pass. Generation, role-specific papers, no answer-key leakage, autosave 8/8, submission, objective scoring 15/20, results page and evaluation all still correct |

Security checks that also passed: bogus token → 404; another candidate's `question_id` → 404
`This question is not part of your assessment.`; awarding 25 marks on a 20-mark question → 422.

---

## 12. Deploying to Render

`render.yaml` in the repo root is a Blueprint for both services.

**Render dashboard -> New -> Blueprint -> select this repository.** It creates:

| Service | Type | Root | Start |
| --- | --- | --- | --- |
| `valamm-assessment-api` | Python web service | `backend` | `python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| `valamm-assessment-web` | Static site | `frontend` | `npm ci && npm run build` -> `dist` |

Then fill in the env vars Render marks as required (they are intentionally not committed):

**On the API service**

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the **Internal Database URL** of your Render Postgres instance (`dpg-dat17kp7lnhs73b8btj0-a`) |
| `ADMIN_PASSWORD_HASH` | bcrypt hash - `python -c "import bcrypt;print(bcrypt.hashpw(b'YourPassword',bcrypt.gensalt()).decode())"` |
| `FRONTEND_BASE_URL` | the static site's URL, e.g. `https://valamm-assessment-web.onrender.com` |
| `CORS_ORIGINS` | the same URL |

`JWT_SECRET` is generated by Render automatically.

**On the static site**

| Variable | Value |
| --- | --- |
| `VITE_API_BASE_URL` | the API's URL, e.g. `https://valamm-assessment-api.onrender.com` |

The schema and seed data are created on the API's first boot (`lifespan` -> `seed.run()`), so there
is no migration step to run by hand.

Two things to get right on Render:

* **Set `DATABASE_URL`.** Left blank it falls back to SQLite on the container's disk, which is wiped
  on every deploy.
* **Resumes need a persistent disk.** The `local` storage backend writes to the container
  filesystem, which Render does not persist on the free plan - uploaded resumes disappear on each
  deploy while their database rows remain, and the download endpoint then returns `410 Gone`.
  Uncomment the `disk:` block in `render.yaml` (paid plan) or implement an object-storage backend as
  described in section 9.

`FRONTEND_BASE_URL` is what generated assessment links are built from, so if it is wrong the links
you copy will point at the wrong host.

---

## 13. Known limitations

* **Duration is advisory.** The candidate page displays the configured duration but does not enforce
  a countdown or auto-submit at expiry.
* **Question editing is API/JSON-based.** *Question Papers* is a read-only viewer; creating a new
  version or adding questions goes through the two POST endpoints (or the JSON seed files), not a
  visual editor.
* **Single admin account**, provisioned from `.env`. There is no admin user-management UI.
* **JWT logout is client-side.** Tokens are stateless and valid until expiry
  (`JWT_EXPIRE_MINUTES`, default 480); there is no server-side revocation list.
* **Rate limiting is in-process**, so it resets on restart and would not be shared across multiple
  backend workers.
* **Email is deliberately manual** — the admin copies the link and sends it, as specified.
* **Browser-rendered UI was not visually inspected** in this session (no browser automation was
  available); the frontend was verified by a clean `tsc` + production build, all routes serving 200,
  and the full API surface being exercised end to end.
* **Local resume storage is not durable in production** — see the warning in section 8.
* **Resume "real-time" updates are polling**, not websockets: the Resumes table refreshes every
  10 seconds and the sidebar badge every 15 seconds.
* **DOCX has no in-browser preview** — the admin gets a download button instead. PDFs preview inline.
* **Resume files are not virus-scanned.** Type, size and container structure are validated, but no
  malware scanning is performed; add a scanner before accepting uploads from the public internet.
* **Old resume versions are retained indefinitely** with no pruning job.
* **A declined assessment cannot be reopened** from the admin UI. The row keeps
  `interest_response = NOT_INTERESTED`; reopening would need a new assessment link (or a direct
  database change).
* **The interest question is per-assessment, not per-role** — declining one role's assessment does
  not affect any other assessment for the same candidate.
