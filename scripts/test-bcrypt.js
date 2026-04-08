const bcrypt = require('bcryptjs');

async function testBcrypt() {
  try {
    const password = 'mypassword';
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    console.log('Hash:', hash);
    const isMatch = await bcrypt.compare(password, hash);
    console.log('Match:', isMatch);
  } catch (error) {
    console.error('Bcrypt Error:', error);
  }
}

testBcrypt();
