# Placement Management System (PMS)

A comprehensive full-stack web application designed for educational institutions to manage student placements, job postings, and recruitment processes efficiently.

## 🚀 Project Overview
This system provides two main interfaces:
1. **Student Portal**: Allows students to register, view job postings from various companies, apply for jobs, and track their application status.
2. **Admin Portal**: Enables administrators to manage company profiles, post new job opportunities, view student applications, and update their status (Shortlisted, Selected, Rejected).

## 🛠️ Built With
- **Backend**: Node.js (Core `http` module, `fs`, `url`, `path`)
- **Database**: PostgreSQL (`pg` module)
- **Frontend**: HTML5, CSS3, Bootstrap 5, Vanilla JavaScript
- **Authentication**: Custom session management using `localStorage` and simple role-based validation.

## 📁 Folder Structure
```
project/
│── server.js          # Main entry point (HTTP Server)
│── db.js              # Database connection logic
│── schema.sql         # Database tables and sample data
│── README.md          # Project documentation
│── public/            # Static assets
│   ├── css/           # Custom stylesheets
│   ├── js/            # Client-side JavaScript
│   ├── images/        # Placeholder for images
│   └── pages/         # HTML pages (index, login, register, dashboards)
└── resumes/           # Directory for student resumes (simulated)
```

## 🗄️ Database Setup Instructions
1. Install **PostgreSQL** and **pgAdmin4**.
2. Create a new database named `placement_db`.
3. Open the Query Tool in pgAdmin4.
4. Copy the contents of `schema.sql` and run the queries to create all required tables.
5. **Default Admin Login**:
   - **Email**: `admin@gmail.com`
   - **Password**: `admin123`

## 🏃 How to Run the Project
1. Ensure Node.js is installed.
2. Clone the project and navigate to the root directory.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Configure your database credentials in `db.js` or via environment variables.
5. Start the server:
   ```bash
   npm run dev
   ```
6. Open your browser and visit `http://localhost:3000`.

## 📡 API Endpoints
- `POST /api/register`: Register a new student.
- `POST /api/login`: Authenticate student or admin.
- `GET /api/jobs`: Fetch all available job postings.
- `POST /api/apply`: Submit a job application.
- `GET /api/admin/companies`: Fetch all registered companies.
- `POST /api/admin/companies`: Add a new company.
- `POST /api/admin/jobs`: Post a new job opportunity.
- `GET /api/admin/applications`: View all student applications.
- `POST /api/admin/applications/status`: Update application status.

## 💬 Code Quality
- Modular backend logic using core Node.js modules.
- Clean and responsive UI using Bootstrap 5.
- Proper error handling and JSON responses.
- Comments included for all critical logic blocks.
