import React, { useState } from 'react';

const AuthForm = () => {
  const [isRegister, setIsRegister] = useState(false); // Toggle between login/register

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    userType: 'Student (CR)',
    branch: '',
    division: '',
  });

  const handleChange = (e) => {
    setFormData({ 
      ...formData, 
      [e.target.name]: e.target.value 
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isRegister) {
      console.log('Registering user:', formData);
    } else {
      console.log('Logging in user:', {
        email: formData.email,
        password: formData.password,
        userType: formData.userType,
      });
    }
    // TODO: Connect to backend
  };

  return (
    <div className='w-full h-full flex justify-center items-center my-5'>
        <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
        <h2 className="text-2xl font-bold text-center text-gray-700 mb-6">
          {isRegister ? 'Register New Account' : 'Login'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Name */}
          {isRegister && (
            <div>
              <label className="block mb-1 text-gray-600">Full Name</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          )}

          {/* Email */}
          <div>
            <label className="block mb-1 text-gray-600">College Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block mb-1 text-gray-600">Password</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* User Type */}
          <div>
            <label className="block mb-1 text-gray-600">User Type</label>
            <select
              name="userType"
              value={formData.userType}
              onChange={handleChange}
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option>Student (CR)</option>
              <option>Teacher</option>
            </select>
          </div>

          {/* Branch and Division */}
          {isRegister && (
            <>
              <div>
                <label className="block mb-1 text-gray-600">Branch</label>
                <select
                  name="branch"
                  value={formData.branch}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  <option value="">Select Branch</option>
                  <option value="CSE">CSE</option>
                  <option value="ECE">ECE</option>
                  <option value="MECH">MECH</option>
                  <option value="EEE">EEE</option>
                  <option value="CIV">CIV</option>
                </select>
              </div>

              <div>
                <label className="block mb-1 text-gray-600">Division</label>
                <input
                  type="text"
                  name="division"
                  value={formData.division}
                  onChange={handleChange}
                  placeholder="e.g. A or B"
                  required
                  className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            </>
          )}

          {/* Submit */}
          <div className="pt-4">
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 transition"
            >
              {isRegister ? 'Register' : 'Login'}
            </button>
          </div>

          {/* Toggle between Login and Register */}
          <div className="text-center pt-2 text-sm text-gray-600">
            {isRegister ? (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  className="text-blue-600 underline"
                  onClick={() => setIsRegister(false)}
                >
                  Login
                </button>
              </>
            ) : (
              <>
                Don't have an account?{' '}
                <button
                  type="button"
                  className="text-blue-600 underline"
                  onClick={() => setIsRegister(true)}
                >
                  Register
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default AuthForm;
