# Secure Media Vault – Backend

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Supabase Setup](#supabase-setup)
- [Installation](#installation)
- [Running the Server](#running-the-server)
- [GraphQL API](#graphql-api)
- [Edge Functions](#edge-functions)
- [Database Schema](#database-schema)
- [Testing](#testing)
- [Security Model](#security-model)
- [Troubleshooting](#troubleshooting)

---

## Overview
Secure Media Vault provides a secure backend for uploading, sharing, and verifying media files using **Supabase**, **GraphQL**, **Row-Level Security (RLS)**, and **Edge Functions**. Features include:
- Private file storage
- SHA-256 file integrity verification
- Version conflict detection
- Permission-based file sharing
- Signed URL generation
- Supabase authentication with RLS enforcement

---

## Prerequisites
- Node.js 16 or higher
- npm or yarn
- Supabase Project
- Supabase CLI installed globally

## Install Supabase CLI with:

  npm install -g supabase



---

## Environment Variables
Backend environment variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`

Frontend environment variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

## Supabase Setup
- Create a storage bucket with private access.
- Enable Row-Level Security (RLS) on all relevant tables and storage buckets.
- Define RLS policies to restrict access by file owner or shared permissions.
- Use Supabase built-in authentication for user identity and session management.

---

## Installation
- Clone or download the Secure Media Vault backend repository.
- In the project directory, install dependencies:
  npm install


---

## Running the Server
Start the backend server:  npm start


Ensure your environment variables are properly loaded before running.

---

## GraphQL API
- Provides endpoints to upload files, generate signed URLs, manage file metadata, and verify integrity.
- Supports file version conflict detection.
- Uses Supabase Edge Functions to handle upload URLs and authorization securely.

---

## Edge Functions
- Implement serverless functions at the edge for handling critical tasks such as signed URL generation and permission checks.
- Enhance performance and security by offloading authentication-sensitive logic.

---

## Database Schema
- Tables include `files`, `users`, `file_shares`, and logs.
- File metadata stores SHA-256 hashes for file integrity.
- Versioning handled with version numbers and timestamps.

---

## Testing
- Automated tests cover version conflict detection, file upload workflow, and integrity verification.
- Use mock Edge Functions for isolated integration testing.

---

## Security Model
- Supabase RLS enforces fine-grained access control.
- SHA-256 hashing ensures file integrity is maintained and verifiable.
- Permissions on shares are strictly enforced at the database and application level.

---

## Troubleshooting
- Verify environment variables and Supabase project configuration.
- Check RLS policies if access is denied unexpectedly.
- Review server and Edge Functions logs for errors.

---

This single markdown file is a concise, practical guide for setting up and running the Secure Media Vault backend using Supabase and related technologies with a focus on security, integrity verification, and permission control.




