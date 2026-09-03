import { useState } from 'react';
import './App.css';
import Navbar from './components/Navbar';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom'; // Add Router for navigation
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import Register from './components/Register';
import TimetableManager from './components/TimetableManager';
import ClassView from './components/ClassView';

function App() {
  return (
    <Router> {/* Wrap your app in Router */}
      <div className="fixed inset-0 -z-10 h-full w-full bg-lime-300 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px]">
        <div className="absolute left-0 right-0 top-0 -z-10 m-auto h-[310px] w-[310px] rounded-full bg-rose-400 opacity-20 blur-[100px]"></div>
      </div>

      <Navbar />

      <Routes> {/* Define the routes here */}
        <Route path="/" element={<Dashboard />} />
        <Route path="/class-view" element={<ClassView />} />
        <Route path="/timetable" element={<TimetableManager />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Routes>
    </Router>
  );
}

export default App;
