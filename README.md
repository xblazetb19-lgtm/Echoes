# Act-III Music Player

## Introduction
This document contains the instructions for setting up the Act-III Music Player application on Render and Supabase.

## Prerequisites
- Node.js (latest LTS version)
- Git
- Render account
- Supabase account

## Setting Up on Render
1. **Create a New Web Service**:  
   Go to your Render dashboard, and click on **New** > **Web Service**.
   
2. **Connect Your Repository**:  
   Select the GitHub repository where the Act-III Music Player code is stored.

3. **Configure Build Settings**:  
   - **Environment**: Choose `Node`.
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start`
   
4. **Set Up Environment Variables**:  
   In the Render dashboard, go to the **Environment** section and set the following variables:
   - `DATABASE_URL`: Your Supabase database URL.
   - `SUPABASE_SERVICE_KEY`: Your Supabase service role key.
   
5. **Deploy the Service**:  
   Click on **Create Web Service** and Render will automatically deploy your application.

## Setting Up on Supabase
1. **Create a New Project**:  
   Log into your Supabase account and create a new project.  
   
2. **Configure Database**:  
   - After the project is created, navigate to the **Database** section.  
   - Use the SQL editor to set up the necessary tables for the Music Player application.  
   ```sql
   CREATE TABLE songs (
       id SERIAL PRIMARY KEY,
       title TEXT,
       artist TEXT,
       url TEXT
   );
   ```  
   
3. **Retrieve API Keys**:  
   In the project settings, obtain your `API URL` and `API Key` to integrate with the Act-III Music Player.  

## Conclusion
You are now ready to use the Act-III Music Player. Ensure that everything is correctly set up on Render and Supabase before running the application.