require('dotenv').config();
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function checkModel() {
  const model = 'gpt-5-mini';
  console.log(`Checking if model '${model}' exists...`);
  
  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: [{ role: 'user', content: 'Say hello and tell me what model you are.' }],
      max_completion_tokens: 100,
    });
    console.log('--- RAW RESPONSE CHOICE ---');
    console.log(JSON.stringify(response.choices[0], null, 2));
    console.log('--- END ---');
    console.log('✅ It worked! The model is alive.');
  } catch (error) {
    console.error('❌ Error calling API:', error.message);
  }
}

checkModel();
