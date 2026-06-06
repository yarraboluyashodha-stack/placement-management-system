const http = require('http'); // Native Node HTTP server.
const fs = require('fs'); // Filesystem access for uploads and static files.
const fsp = fs.promises; // Promise-based fs helpers.
const path = require('path'); // Cross-platform path helpers.
const url = require('url'); // URL parser for routing.
const crypto = require('crypto'); // Password hashing and token generation.
const pool = require('./db.js'); // PostgreSQL connection pool.

const PORT = Number(process.env.PORT) || 3333; // Server port with fallback.
const HOST = process.env.HOST || '127.0.0.1'; // Host binding with fallback.
const PUBLIC_DIR = path.join(process.cwd(), 'public'); // Root directory for static assets.
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads', 'resumes'); // Resume upload location.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // Session validity window (8 hours).
const sessions = new Map(); // In-memory token store.

fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // Ensure upload directory exists.

const CONTENT_TYPES = { // MIME map for static file responses.
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const sendJson = (res, statusCode, payload) => { // Sends a JSON HTTP response.
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
};

const sendText = (res, statusCode, text) => { // Sends a plain-text HTTP response.
    res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
    res.end(text);
};

const parseBody = (req, maxBytes = 10 * 1024 * 1024) => new Promise((resolve, reject) => { // Parses JSON request body safely.
    let body = '';
    let received = 0;

    req.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxBytes) {
            reject(new Error('Payload too large'));
            req.destroy();
            return;
        }
        body += chunk.toString();
    });

    req.on('end', () => {
        try {
            resolve(JSON.parse(body || '{}'));
        } catch (err) {
            reject(new Error('Invalid JSON body'));
        }
    });

    req.on('error', reject);
});

const hashPassword = (password) => { // Hashes passwords using scrypt + random salt.
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
};

const verifyPassword = (storedPassword, inputPassword) => { // Verifies plain or hashed passwords.
    if (typeof storedPassword !== 'string' || typeof inputPassword !== 'string') {
        return false;
    }

    if (!storedPassword.startsWith('scrypt$')) {
        return storedPassword === inputPassword;
    }

    const parts = storedPassword.split('$');
    if (parts.length !== 3) {
        return false;
    }

    const salt = parts[1];
    const originalHashHex = parts[2];
    const derivedHashHex = crypto.scryptSync(inputPassword, salt, 64).toString('hex');
    const original = Buffer.from(originalHashHex, 'hex');
    const derived = Buffer.from(derivedHashHex, 'hex');

    if (original.length !== derived.length) {
        return false;
    }

    return crypto.timingSafeEqual(original, derived);
};

const createSession = (userId, role) => { // Creates a session token and stores it in memory.
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
        userId,
        role,
        expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return token;
};

const getAuthToken = (req) => { // Extracts bearer token from Authorization header.
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.slice('Bearer '.length).trim();
};

const getAuthUser = (req) => { // Resolves token to authenticated session user.
    const token = getAuthToken(req);
    if (!token) {
        return null;
    }

    const session = sessions.get(token);
    if (!session) {
        return null;
    }

    if (Date.now() > session.expiresAt) {
        sessions.delete(token);
        return null;
    }

    return { token, ...session };
};

const requireAuth = (req, res, allowedRoles = []) => { // Guards routes by authentication and role.
    const auth = getAuthUser(req);
    if (!auth) {
        sendJson(res, 401, { error: 'Unauthorized. Please login first.' });
        return null;
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(auth.role)) {
        sendJson(res, 403, { error: 'Forbidden. You do not have access.' });
        return null;
    }

    return auth;
};

const toInt = (value) => { // Converts incoming value to integer or null.
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
};

const cleanFileName = (name) => path.basename(String(name || 'resume.pdf')).replace(/[^a-zA-Z0-9._-]/g, '_'); // Sanitizes uploaded file names.

const safePublicPath = (requestPath) => { // Prevents path traversal for static file requests.
    const normalized = path.normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const absolute = path.resolve(PUBLIC_DIR, `.${normalized}`);
    if (!absolute.startsWith(PUBLIC_DIR)) {
        return null;
    }
    return absolute;
};

const serveStaticFile = async (res, filePath) => { // Serves static files from the public directory.
    try {
        const data = await fsp.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    } catch {
        sendText(res, 404, '404 Not Found');
    }
};

const ensureSchemaUpdates = async () => { // Adds new columns if older schema is in use.
    await pool.query('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS eligibility_criteria TEXT');
    await pool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS resume_path TEXT');
};

const cleanupExpiredSessions = () => { // Removes expired session tokens from memory.
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
        if (session.expiresAt <= now) {
            sessions.delete(token);
        }
    }
};

setInterval(cleanupExpiredSessions, 30 * 60 * 1000).unref(); // Run cleanup every 30 minutes.

const server = http.createServer(async (req, res) => { // Main request router and API handler.
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname || '/';
    const method = req.method || 'GET';

    try {
        if (pathname === '/api/register' && method === 'POST') { // Student registration endpoint.
            const { name, email, password, course, cgpa } = await parseBody(req);

            if (!name || !email || !password) {
                sendJson(res, 400, { error: 'Name, email and password are required.' });
                return;
            }

            const passwordHash = hashPassword(password);
            const result = await pool.query(
                'INSERT INTO students (name, email, password, course, cgpa) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [name, email, passwordHash, course || null, cgpa || null]
            );
            sendJson(res, 201, { message: 'Registration successful', id: result.rows[0].id });
            return;
        }

        if (pathname === '/api/login' && method === 'POST') { // Student/admin login endpoint.
            const { email, password, role } = await parseBody(req);

            if (!email || !password || !role) {
                sendJson(res, 400, { error: 'Email, password and role are required.' });
                return;
            }

            const isAdmin = role === 'admin';
            if (!isAdmin && role !== 'student') {
                sendJson(res, 400, { error: 'Role must be student or admin.' });
                return;
            }

            const table = isAdmin ? 'admins' : 'students';
            const result = await pool.query(`SELECT * FROM ${table} WHERE email = $1`, [email]);

            if (result.rows.length === 0) {
                sendJson(res, 401, { error: 'Invalid credentials' });
                return;
            }

            const user = result.rows[0];
            const isValid = verifyPassword(user.password, password);
            if (!isValid) {
                sendJson(res, 401, { error: 'Invalid credentials' });
                return;
            }

            // If the account still has legacy plaintext password, upgrade it to hashed.
            if (!String(user.password || '').startsWith('scrypt$')) {
                const newHash = hashPassword(password);
                await pool.query(`UPDATE ${table} SET password = $1 WHERE id = $2`, [newHash, user.id]);
            }

            const token = createSession(user.id, role);
            sendJson(res, 200, {
                message: 'Login successful',
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role,
                    course: user.course || null,
                    cgpa: user.cgpa || null,
                    resume_path: user.resume_path || null,
                },
            });
            return;
        }

        if (pathname === '/api/logout' && method === 'POST') { // Session logout endpoint.
            const auth = getAuthUser(req);
            if (auth) {
                sessions.delete(auth.token);
            }
            sendJson(res, 200, { message: 'Logged out successfully.' });
            return;
        }

        if (pathname === '/api/jobs' && method === 'GET') { // Public job listing endpoint.
            const result = await pool.query(`
                SELECT j.*, c.name AS company_name
                FROM jobs j
                JOIN companies c ON j.company_id = c.id
                ORDER BY j.created_at DESC
            `);
            sendJson(res, 200, result.rows);
            return;
        }

        if (pathname === '/api/apply' && method === 'POST') { // Student job application endpoint.
            const auth = requireAuth(req, res, ['student']);
            if (!auth) return;

            const { job_id } = await parseBody(req);
            const jobId = toInt(job_id);
            if (!jobId) {
                sendJson(res, 400, { error: 'Valid job_id is required.' });
                return;
            }

            const existing = await pool.query(
                'SELECT id FROM applications WHERE student_id = $1 AND job_id = $2',
                [auth.userId, jobId]
            );
            if (existing.rows.length > 0) {
                sendJson(res, 409, { error: 'You already applied for this job.' });
                return;
            }

            await pool.query(
                'INSERT INTO applications (student_id, job_id) VALUES ($1, $2)',
                [auth.userId, jobId]
            );

            sendJson(res, 201, { message: 'Application submitted successfully' });
            return;
        }

        if (pathname === '/api/student/profile' && method === 'GET') { // Student profile endpoint.
            const auth = requireAuth(req, res, ['student']);
            if (!auth) return;

            const result = await pool.query(
                'SELECT id, name, email, course, cgpa, resume_path, created_at FROM students WHERE id = $1',
                [auth.userId]
            );
            if (result.rows.length === 0) {
                sendJson(res, 404, { error: 'Student not found.' });
                return;
            }
            sendJson(res, 200, result.rows[0]);
            return;
        }

        if (pathname === '/api/student/applications' && method === 'GET') { // Student application history endpoint.
            const auth = requireAuth(req, res, ['student']);
            if (!auth) return;

            const result = await pool.query(`
                SELECT a.*, j.title AS job_title, c.name AS company_name
                FROM applications a
                JOIN jobs j ON a.job_id = j.id
                JOIN companies c ON j.company_id = c.id
                WHERE a.student_id = $1
                ORDER BY a.applied_at DESC
            `, [auth.userId]);

            sendJson(res, 200, result.rows);
            return;
        }

        if (pathname === '/api/student/resume' && method === 'POST') { // Resume upload endpoint.
            const auth = requireAuth(req, res, ['student']);
            if (!auth) return;

            const { file_name, file_content_base64 } = await parseBody(req, 15 * 1024 * 1024);
            if (!file_name || !file_content_base64) {
                sendJson(res, 400, { error: 'file_name and file_content_base64 are required.' });
                return;
            }

            const cleanName = cleanFileName(file_name);
            const extension = path.extname(cleanName).toLowerCase();
            const allowed = new Set(['.pdf', '.doc', '.docx']);
            if (!allowed.has(extension)) {
                sendJson(res, 400, { error: 'Only PDF, DOC and DOCX files are allowed.' });
                return;
            }

            const rawBase64 = String(file_content_base64).includes(',')
                ? String(file_content_base64).split(',').pop()
                : String(file_content_base64);

            const fileBuffer = Buffer.from(rawBase64 || '', 'base64');
            if (!fileBuffer || fileBuffer.length === 0) {
                sendJson(res, 400, { error: 'Invalid file content.' });
                return;
            }

            if (fileBuffer.length > 5 * 1024 * 1024) {
                sendJson(res, 400, { error: 'File too large. Max allowed size is 5MB.' });
                return;
            }

            const savedFileName = `${auth.userId}_${Date.now()}_${cleanName}`;
            const absolutePath = path.join(UPLOAD_DIR, savedFileName);
            const relativePath = `/uploads/resumes/${savedFileName}`;

            await fsp.writeFile(absolutePath, fileBuffer);
            await pool.query('UPDATE students SET resume_path = $1 WHERE id = $2', [relativePath, auth.userId]);

            sendJson(res, 200, { message: 'Resume uploaded successfully.', resume_path: relativePath });
            return;
        }

        if (pathname === '/api/admin/companies' && method === 'POST') { // Admin creates a company.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const { name, industry, website, description } = await parseBody(req);
            if (!name) {
                sendJson(res, 400, { error: 'Company name is required.' });
                return;
            }

            const result = await pool.query(
                'INSERT INTO companies (name, industry, website, description) VALUES ($1, $2, $3, $4) RETURNING id',
                [name, industry || null, website || null, description || null]
            );
            sendJson(res, 201, { message: 'Company added', id: result.rows[0].id });
            return;
        }

        if (pathname === '/api/admin/companies' && method === 'GET') { // Admin lists all companies.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const result = await pool.query('SELECT * FROM companies ORDER BY created_at DESC');
            sendJson(res, 200, result.rows);
            return;
        }

        const companyIdMatch = pathname.match(/^\/api\/admin\/companies\/(\d+)$/); // Matches /api/admin/companies/:id.
        if (companyIdMatch && method === 'PUT') { // Admin updates a company by id.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const companyId = toInt(companyIdMatch[1]);
            const { name, industry, website, description } = await parseBody(req);
            const result = await pool.query(`
                UPDATE companies
                SET
                    name = COALESCE($1, name),
                    industry = COALESCE($2, industry),
                    website = COALESCE($3, website),
                    description = COALESCE($4, description)
                WHERE id = $5
                RETURNING *
            `, [name || null, industry || null, website || null, description || null, companyId]);

            if (result.rows.length === 0) {
                sendJson(res, 404, { error: 'Company not found.' });
                return;
            }

            sendJson(res, 200, { message: 'Company updated successfully.', company: result.rows[0] });
            return;
        }

        if (pathname === '/api/admin/jobs' && method === 'GET') { // Admin lists all jobs.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const result = await pool.query(`
                SELECT j.*, c.name AS company_name
                FROM jobs j
                JOIN companies c ON j.company_id = c.id
                ORDER BY j.created_at DESC
            `);
            sendJson(res, 200, result.rows);
            return;
        }

        if (pathname === '/api/admin/jobs' && method === 'POST') { // Admin creates a new job.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const { company_id, title, description, salary, location, deadline, eligibility_criteria } = await parseBody(req);
            if (!company_id || !title || !deadline) {
                sendJson(res, 400, { error: 'company_id, title and deadline are required.' });
                return;
            }

            await pool.query(
                `INSERT INTO jobs (company_id, title, description, salary, location, deadline, eligibility_criteria)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    company_id,
                    title,
                    description || null,
                    salary || null,
                    location || null,
                    deadline,
                    eligibility_criteria || null,
                ]
            );
            sendJson(res, 201, { message: 'Job posted successfully' });
            return;
        }

        const jobIdMatch = pathname.match(/^\/api\/admin\/jobs\/(\d+)$/); // Matches /api/admin/jobs/:id.
        if (jobIdMatch && method === 'PUT') { // Admin updates a job by id.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const jobId = toInt(jobIdMatch[1]);
            const { company_id, title, description, salary, location, deadline, eligibility_criteria } = await parseBody(req);
            const result = await pool.query(`
                UPDATE jobs
                SET
                    company_id = COALESCE($1, company_id),
                    title = COALESCE($2, title),
                    description = COALESCE($3, description),
                    salary = COALESCE($4, salary),
                    location = COALESCE($5, location),
                    deadline = COALESCE($6, deadline),
                    eligibility_criteria = COALESCE($7, eligibility_criteria)
                WHERE id = $8
                RETURNING *
            `, [
                company_id || null,
                title || null,
                description || null,
                salary || null,
                location || null,
                deadline || null,
                eligibility_criteria || null,
                jobId,
            ]);

            if (result.rows.length === 0) {
                sendJson(res, 404, { error: 'Job not found.' });
                return;
            }

            sendJson(res, 200, { message: 'Job updated successfully.', job: result.rows[0] });
            return;
        }

        if (jobIdMatch && method === 'DELETE') { // Admin deletes a job by id.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const jobId = toInt(jobIdMatch[1]);
            const result = await pool.query('DELETE FROM jobs WHERE id = $1 RETURNING id', [jobId]);
            if (result.rows.length === 0) {
                sendJson(res, 404, { error: 'Job not found.' });
                return;
            }
            sendJson(res, 200, { message: 'Job deleted successfully.' });
            return;
        }

        if (pathname === '/api/admin/applications' && method === 'GET') { // Admin lists all applications.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const result = await pool.query(`
                SELECT a.*, s.name AS student_name, s.email AS student_email, j.title AS job_title, c.name AS company_name
                FROM applications a
                JOIN students s ON a.student_id = s.id
                JOIN jobs j ON a.job_id = j.id
                JOIN companies c ON j.company_id = c.id
                ORDER BY a.applied_at DESC
            `);
            sendJson(res, 200, result.rows);
            return;
        }

        if (pathname === '/api/admin/applications/status' && method === 'POST') { // Admin updates application status.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const { application_id, status } = await parseBody(req);
            const allowedStatuses = new Set(['Pending', 'Shortlisted', 'Rejected', 'Selected']);
            if (!application_id || !status || !allowedStatuses.has(status)) {
                sendJson(res, 400, { error: 'Valid application_id and status are required.' });
                return;
            }

            const result = await pool.query(
                'UPDATE applications SET status = $1 WHERE id = $2 RETURNING id',
                [status, application_id]
            );
            if (result.rows.length === 0) {
                sendJson(res, 404, { error: 'Application not found.' });
                return;
            }

            sendJson(res, 200, { message: 'Status updated' });
            return;
        }

        if (pathname === '/api/admin/students' && method === 'GET') { // Admin lists all students.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const result = await pool.query(`
                SELECT id, name, email, course, cgpa, resume_path, created_at
                FROM students
                ORDER BY created_at DESC
            `);
            sendJson(res, 200, result.rows);
            return;
        }

        const studentIdMatch = pathname.match(/^\/api\/admin\/students\/(\d+)$/); // Matches /api/admin/students/:id.
        if (studentIdMatch && method === 'PUT') { // Admin updates a student by id.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const studentId = toInt(studentIdMatch[1]);
            const { name, email, course, cgpa, resume_path } = await parseBody(req);

            const result = await pool.query(`
                UPDATE students
                SET
                    name = COALESCE($1, name),
                    email = COALESCE($2, email),
                    course = COALESCE($3, course),
                    cgpa = COALESCE($4, cgpa),
                    resume_path = COALESCE($5, resume_path)
                WHERE id = $6
                RETURNING id, name, email, course, cgpa, resume_path, created_at
            `, [
                name || null,
                email || null,
                course || null,
                cgpa || null,
                resume_path || null,
                studentId,
            ]);

            if (result.rows.length === 0) {
                sendJson(res, 404, { error: 'Student not found.' });
                return;
            }

            sendJson(res, 200, { message: 'Student updated successfully.', student: result.rows[0] });
            return;
        }

        if (studentIdMatch && method === 'DELETE') { // Admin deletes a student by id.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const studentId = toInt(studentIdMatch[1]);
            const result = await pool.query('DELETE FROM students WHERE id = $1 RETURNING id', [studentId]);
            if (result.rows.length === 0) {
                sendJson(res, 404, { error: 'Student not found.' });
                return;
            }
            sendJson(res, 200, { message: 'Student deleted successfully.' });
            return;
        }

        if (pathname === '/api/admin/reports/summary' && method === 'GET') { // Admin dashboard summary report.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const result = await pool.query(`
                SELECT
                    (SELECT COUNT(*)::int FROM students) AS total_students,
                    (SELECT COUNT(*)::int FROM companies) AS total_companies,
                    (SELECT COUNT(*)::int FROM jobs) AS total_jobs,
                    (SELECT COUNT(*)::int FROM applications) AS total_applications,
                    (SELECT COUNT(*)::int FROM applications WHERE status = 'Selected') AS selected_applications,
                    (SELECT COUNT(*)::int FROM applications WHERE status = 'Shortlisted') AS shortlisted_applications,
                    (
                        SELECT COUNT(DISTINCT student_id)::int
                        FROM applications
                        WHERE status = 'Selected'
                    ) AS placed_students
            `);

            const summary = result.rows[0];
            const placementRate = summary.total_students > 0
                ? Number(((summary.placed_students / summary.total_students) * 100).toFixed(2))
                : 0;

            sendJson(res, 200, { ...summary, placement_rate: placementRate });
            return;
        }

        if (pathname === '/api/admin/reports/student-status' && method === 'GET') { // Admin student placement-status report.
            const auth = requireAuth(req, res, ['admin']);
            if (!auth) return;

            const result = await pool.query(`
                SELECT
                    s.id,
                    s.name,
                    s.email,
                    s.course,
                    s.cgpa,
                    s.resume_path,
                    COUNT(a.id)::int AS applications_count,
                    COALESCE((ARRAY_AGG(a.status ORDER BY a.applied_at DESC))[1], 'Not Applied') AS latest_status,
                    SUM(CASE WHEN a.status = 'Selected' THEN 1 ELSE 0 END)::int AS selected_count
                FROM students s
                LEFT JOIN applications a ON a.student_id = s.id
                GROUP BY s.id
                ORDER BY s.created_at DESC
            `);

            const students = result.rows.map((row) => ({
                ...row,
                placement_status: row.selected_count > 0
                    ? 'Placed'
                    : (row.latest_status === 'Not Applied' ? 'Not Applied' : 'In Process'),
            }));

            sendJson(res, 200, students);
            return;
        }

        if (pathname.startsWith('/api/')) { // Catch-all for unknown API routes.
            sendJson(res, 404, { error: 'API route not found.' });
            return;
        }

        let requestPath = pathname; // Preserve requested path for static routing.
        if (requestPath === '/' || requestPath === '/index.html') { // Default landing page.
            requestPath = '/pages/index.html';
        } else if (!requestPath.startsWith('/pages/') && !requestPath.startsWith('/css/') && !requestPath.startsWith('/js/') && !requestPath.startsWith('/images/') && !requestPath.startsWith('/uploads/')) { // Pretty URL support for pages.
            const pageName = requestPath.substring(1);
            requestPath = `/pages/${pageName}.html`;
        }

        const absolutePath = safePublicPath(requestPath); // Resolve and validate final static path.
        if (!absolutePath) { // Block any unsafe path access.
            sendText(res, 403, 'Forbidden');
            return;
        }

        await serveStaticFile(res, absolutePath);
    } catch (err) {
        if (err && err.code === '23505') { // PostgreSQL unique-key violation.
            sendJson(res, 409, { error: 'A record with this unique value already exists.' });
            return;
        }

        if (err && err.message === 'Payload too large') { // Request body limit exceeded.
            sendJson(res, 413, { error: 'Payload too large.' });
            return;
        }

        if (err && err.message === 'Invalid JSON body') { // JSON parse failure from request body.
            sendJson(res, 400, { error: 'Invalid JSON body.' });
            return;
        }

        console.error('Server error:', err);
        sendJson(res, 500, { error: 'Internal server error.' });
    }
});

const start = async () => { // Bootstraps schema updates and starts HTTP server.
    try {
        await ensureSchemaUpdates();
    } catch (err) {
        console.error('Schema update failed:', err);
    }

    server.listen(PORT, HOST, () => {
        console.log(`Server running at http://${HOST}:${PORT}/`);
    });
};

start();
