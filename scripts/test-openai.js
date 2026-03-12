require('dotenv').config();
const { OpenAI } = require('openai');

const testOpenAI = async () => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || apiKey.includes('your-openai-api-key')) {
    console.error('❌ ERROR: OPENAI_API_KEY is missing or invalid in your .env file.');
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey });

  console.log('🤖 Testing OpenAI Connection...');

  try {
    // 1. Text test (GPT-5 mini)
    process.stdout.write('   - GPT-5 mini test... ');
    const textRes = await openai.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: 'Say "Connection successful!" in 2 words.' }],
    });
    console.log(`✅ [${textRes.choices[0].message.content.trim()}]`);

    // 2. Whisper availability test
    // (We'll just list models as a proxy for API access)
    process.stdout.write('   - Whisper availability test... ');
    const models = await openai.models.list();
    const whisper = models.data.some(m => m.id.includes('whisper'));
    if (whisper) {
      console.log('✅ [Found whisper-1]');
    } else {
      console.log('⚠️ [whisper-1 not found in models list, check your tier permissions]');
    }

    console.log('\n🌟 GREAT NEWS! Your OpenAI configuration is ready for Revision AI.');
    process.exit(0);
  } catch (error) {
    console.log('❌ FAILED');
    console.error('\n🛑 OpenAI API Error:');
    console.error(error.message);

    if (error.status === 401) {
      console.error('👉 TIP: Your API key is incorrect.');
    } else if (error.status === 429) {
      console.error('👉 TIP: You have exceeded your quota or rate limit. Your OpenAI account needs credits or a valid billing plan.');
    } else if (error.status === 404) {
      console.error('👉 TIP: Model (gpt-5-mini) not found. Your account might not have access to this model yet.');
    }

    process.exit(1);
  }
};

testOpenAI();
