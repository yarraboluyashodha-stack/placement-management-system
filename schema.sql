-- Placement Management System Database Schema

-- 1. Students Table: Stores student registration and profile details
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY, -- Unique identifier for each student
    name VARCHAR(100) NOT NULL, -- Full name of the student
    email VARCHAR(100) UNIQUE NOT NULL, -- Unique email address for login
    password VARCHAR(255) NOT NULL, -- Hashed password (for simplicity, we'll store plain text for this student project)
    course VARCHAR(100), -- Course name (e.g., B.Tech, MCA)
    cgpa DECIMAL(4, 2), -- Cumulative Grade Point Average
    resume_path TEXT, -- Path to the uploaded resume file
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- Record creation time
);

-- 2. Admins Table: Stores administrative account details
CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY, -- Unique identifier for each admin
    name VARCHAR(100) NOT NULL, -- Name of the administrator
    email VARCHAR(100) UNIQUE NOT NULL, -- Unique email address for admin login
    password VARCHAR(255) NOT NULL, -- Admin password
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- Record creation time
);

-- 3. Companies Table: Stores information about hiring companies
CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY, -- Unique identifier for each company
    name VARCHAR(100) NOT NULL, -- Name of the company
    industry VARCHAR(100), -- Industry type (e.g., IT, Finance)
    website TEXT, -- Company website URL
    description TEXT, -- Brief description of the company
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- Record creation time
);

-- 4. Jobs Table: Stores job postings created by admins
CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY, -- Unique identifier for each job posting
    company_id INT REFERENCES companies(id) ON DELETE CASCADE, -- Reference to the company
    title VARCHAR(100) NOT NULL, -- Job title (e.g., Software Engineer)
    description TEXT, -- Detailed job description
    eligibility_criteria TEXT, -- Eligibility rules such as minimum CGPA or required skills
    salary VARCHAR(50), -- Offered salary package
    location VARCHAR(100), -- Job location
    deadline DATE, -- Application deadline
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- Posting creation time
);

-- 5. Applications Table: Stores job applications submitted by students
CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY, -- Unique identifier for each application
    student_id INT REFERENCES students(id) ON DELETE CASCADE, -- Reference to the student
    job_id INT REFERENCES jobs(id) ON DELETE CASCADE, -- Reference to the job
    status VARCHAR(50) DEFAULT 'Pending', -- Application status (Pending, Shortlisted, Rejected, Selected)
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- Time of application
);

-- Insert a default admin for initial login
-- Email: admin@gmail.com | Password: admin123
INSERT INTO admins (name, email, password) 
VALUES ('System Admin', 'admin@gmail.com', 'admin123')
ON CONFLICT (email) DO NOTHING;
