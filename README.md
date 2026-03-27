# 🧠 Revision AI — AI Learning & Revision Companion

A full-stack AI-powered learning assistant that helps you retain technical knowledge through **active recall**, **voice explanations**, and **AI-driven evaluation**.

---

## 🏗️ Architecture

```
Revision AI/
├── server.js               ← Express backend entry point
├── src/
│   ├── config/db.js        ← MongoDB connection
│   ├── middleware/auth.js  ← JWT middleware
│   ├── models/             ← Mongoose models (User, Topic, Question, Answer, Session)
│   ├── routes/             ← API routes (auth, topics, questions, sessions, answers, dashboard, speech)
│   └── services/
│       └── aiService.js    ← OpenAI gpt-5-mini + Whisper integration
├── mobile/                 ← React Native (Expo) app
│   ├── App.js
│   └── src/
│       ├── config/api.js       ← API base URL
│       ├── constants/theme.js  ← Design system (colors, fonts, sizes)
│       ├── context/AuthContext.js
│       ├── navigation/AppNavigator.js
│       ├── screens/
│       │   ├── AuthScreen.js       ← Login / Register
│       │   ├── HomeScreen.js       ← Dashboard home
│       │   ├── TopicsScreen.js     ← Topic list + add
│       │   ├── TopicDetailScreen.js← Notes + Questions
│       │   ├── RevisionScreen.js   ← Voice Q&A + AI feedback ⭐
│       │   ├── DashboardScreen.js  ← Analytics
│       │   ├── HistoryScreen.js    ← Session history
│       │   └── SettingsScreen.js   ← Preferences + Logout
│       └── services/api.js     ← Axios API service
```

---

## 🚀 Setup Instructions

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- OpenAI API Key (with gpt-5-mini + Whisper access)
- Expo Go app on your phone (iOS or Android)

---

### 1. Backend Setup

```bash
# In the project root (d:\Revision AI)

# Copy and configure .env
copy .env.example .env
# → Open .env and add your OPENAI_API_KEY and MONGO_URI

# Start the backend server
npm run dev
```

The server will start at `http://localhost:5000`

**Check it works:**
```
GET http://localhost:5000/health
```

---

### 2. Mobile App Setup

```bash
cd mobile

# Find your PC's local IP address:
# Windows: ipconfig → look for IPv4 Address (e.g., 192.168.1.100)

# Edit src/config/api.js and update:
#   const API_BASE_URL = 'http://YOUR_LOCAL_IP:5000/api';

# Start Expo
npx expo start
```

Scan the QR code with Expo Go on your phone. Make sure your phone and PC are on the **same WiFi network**.

---

## ⚙️ Configuration

### Backend `.env`
| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 5000) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret key for JWT tokens |
| `OPENAI_API_KEY` | Your OpenAI API key (gpt-5-mini + Whisper) |
| `NODE_ENV` | `development` or `production` |

### Mobile `src/config/api.js`
Update `API_BASE_URL` to your machine's local IP address.

---

## 📱 App Screens

| Screen | Description |
|--------|-------------|
| **Auth** | Login / Register with JWT |
| **Home** | Overview: streak, stats, quick actions, weak topics |
| **Topics** | Add notes → AI generates questions automatically |
| **Topic Detail** | View notes and generated questions |
| **Revision** | Voice Q&A → Whisper → gpt-5-mini evaluation → feedback |
| **Analytics** | Weekly chart, mastery bars, AI insights |
| **History** | Paginated session list |
| **Settings** | Daily goal, difficulty, preferences |

---

## 🤖 AI Features

### Question Generation (gpt-5-mini)
When you add a topic with notes, the AI automatically generates **8 diverse questions** covering:
- Concept Questions
- Explanation Questions
- Scenario Questions
- Practical Questions

### Answer Evaluation (gpt-5-mini)
After you speak your answer, the AI returns:
- **Score** (1–10)
- **Correct points** ✅
- **Missing concepts** ❌
- **Suggestions** 💡
- **Overall feedback**

### Spaced Repetition
Questions have a SM-2-inspired algorithm:
- Good score → longer review interval
- Poor score → short interval (review sooner)

### Weekly Insights (gpt-5-mini)
On-demand AI analysis of your learning patterns including strengths, areas to improve, and personalized recommendations.

---

## 🛠️ API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/login` | Login |
| GET | `/api/topics` | List topics |
| POST | `/api/topics` | Create topic + trigger question generation |
| GET | `/api/questions/topic/:id` | Get questions for topic |
| GET | `/api/questions/due` | Spaced repetition due questions |
| POST | `/api/sessions/start` | Start revision session |
| PUT | `/api/sessions/:id/complete` | End session |
| POST | `/api/answers/submit` | Submit voice answer for AI evaluation |
| POST | `/api/speech/transcribe` | Whisper audio → text |
| GET | `/api/dashboard` | Full analytics |
| GET | `/api/dashboard/insights` | AI weekly insights |

---

## 💰 Cost Estimate (Single User / Month)

| Service | Est. Cost |
|---------|-----------|
| gpt-5-mini (questions + evaluation) | ~$3–$8 |
| Whisper (transcription) | ~$2 |
| MongoDB Atlas (free tier) | $0 |
| Hosting (Railway/Render free) | $0–$5 |
| **Total** | **~$7–$19** |

---

## 🔮 Future Enhancements
- [ ] Push notifications (daily reminder)
- [ ] Semantic note search (vector embeddings)
- [ ] Adaptive difficulty (auto-adjusts based on performance)
- [ ] Multi-user support
- [ ] Web version (Next.js)
- [ ] Export reports as PDF
