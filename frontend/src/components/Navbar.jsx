import React from 'react';
import {Link, NavLink } from 'react-router-dom'; // Adding react-router for navigation

const Navbar = () => {
  return (
    <div className='w-full flex items-center px-5 py-4 bg-white bg-opacity-50 shadow-md'>
      {/* Left: Logo */}
      <h1 className='text-2xl font-bold text-gray-800'>
        AutoWatt
      </h1>

      {/* Center: Navigation Links */}
      <div className='w-[70vw] mx-auto'>
        <ul className='w-full flex justify-center space-x-8'>
          <li>
            <NavLink to="" className={({isActive})=>`${isActive?"text-lime-600":"text-gray-700"}`}>
              Dashboard
            </NavLink>
          </li>
          <li>
            <NavLink to="class-view" className={({isActive})=>`${isActive?"text-lime-600":"text-gray-700"}`}>
              Class View
            </NavLink>
          </li>
          <li>
            <NavLink to="timetable" className={({isActive})=>`${isActive?"text-lime-600":"text-gray-700"}`}>
              Time Table
            </NavLink>
          </li>
        </ul>
      </div>

      {/* Right: Login Button */}
      <div>
        <Link to="/login">
          <button className='bg-lime-600 text-white px-5 py-2 rounded-full hover:bg-lime-700 transition duration-300'>
            Login
          </button>
        </Link>
      </div>
    </div>
  );
};

export default Navbar;
