const axios = require('axios');

async function testLogin() {
  try {
    const res = await axios.post('http://localhost:5000/api/auth/login', {
      email: 'rajpatil2k@gmail.com',
      password: 'wrongpassword'
    });
    console.log('Response:', res.data);
  } catch (error) {
    if (error.response) {
      console.log('Error Response:', error.response.status, error.response.data);
    } else {
      console.log('Error:', error.message);
    }
  }
}

testLogin();
