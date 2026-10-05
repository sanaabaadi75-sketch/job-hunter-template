@echo off
rem Runs the job hunter once and appends its output to applications\hunt_log.txt.
rem Task Scheduler runs this every hour (task name: "Job hunter").
cd /d "%~dp0"
if not exist applications mkdir applications
echo ===== %date% %time% ===== >> applications\hunt_log.txt
call npm run hunt >> applications\hunt_log.txt 2>&1
