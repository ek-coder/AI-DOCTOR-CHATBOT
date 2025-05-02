import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import medicationsData from './medications.json'; // Import local medication data

// --- Helper Functions (based on Python logic) ---

// Simple keyword/regex-based condition extraction (can be improved)
function extractConditions(query, history = []) {
  const combinedText = (query + ' ' + history.filter(msg => msg.text).map(msg => msg.text).join(' ')).toLowerCase();
  const conditions = new Set();

  // Direct requests
  if (/medicine for|medication for|treat|cure|help with|for my|for the/.test(combinedText)) {
    const match = combinedText.match(/(?:fever|cold|cough|headache|allergy|indigestion|diarrhea|insomnia|pain|stomach ache|sore throat|runny nose|sneezing|chills|body ache|nausea|vomiting|rash|itching)/);
    if (match) conditions.add(match[0]);
  }

  // Symptoms mentioned
  const symptomMap = {
    headache: 'headache', fever: 'fever', cold: 'cold', cough: 'cough',
    'sore throat': 'cough', // Map sore throat to cough for simplicity
    'runny nose': 'cold', sneezing: 'cold', chills: 'fever',
    'body ache': 'pain', pain: 'pain', 'stomach ache': 'indigestion', // Approximate
    diarrhea: 'diarrhea', nausea: 'indigestion', vomiting: 'indigestion', // Approximate
    allergy: 'allergy', rash: 'allergy', itching: 'allergy', // Approximate
    insomnia: 'insomnia', 'trouble sleeping': 'insomnia'
  };

  for (const symptom in symptomMap) {
    if (combinedText.includes(symptom)) {
      conditions.add(symptomMap[symptom]);
    }
  }

  // Fallback if medicine is mentioned but no condition identified
  if (conditions.size === 0 && /medicine|medication/.test(combinedText)) {
      conditions.add('fever'); // Default fallback
  }

  console.log("Extracted Conditions:", Array.from(conditions));
  return Array.from(conditions);
}


// Search local JSON data
function searchMedications(condition) {
  console.log("Searching for condition:", condition);
  if (!condition) return null;
  const found = medicationsData.find(med => med.condition.toLowerCase() === condition.toLowerCase());
  console.log("Found medication:", found);
  return found; // Return the first match or null
}


// --- React Component ---

function App() {
  const [apiKey, setApiKey] = useState('');
  const [apiKeyEntered, setApiKeyEntered] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [chatHistory, setChatHistory] = useState([]); // { sender: 'user'/'ai'/'system', text: '', medication?: {...} }
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const chatEndRef = useRef(null); // For auto-scrolling
  const inputRef = useRef(null); // To focus input after sending

  // Scroll to bottom of chat on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // Focus input field after loading completes
  useEffect(() => {
    if (!isLoading && apiKeyEntered) {
      inputRef.current?.focus();
    }
  }, [isLoading, apiKeyEntered]);

  const handleApiKeyChange = (e) => {
    setApiKey(e.target.value);
  };

  const handleApiKeySubmit = () => {
    if (apiKey.trim()) {
      setApiKeyEntered(true);
      setError(null); // Clear previous errors
      setChatHistory([{ 
         sender: 'system', 
         text: 'API Key set. Ask about your symptoms.' 
      }]);
    } else {
      setError("Please enter a valid Gemini API Key.");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && apiKey.trim()) {
      handleApiKeySubmit();
    }
  };

  const handleInputChange = (e) => {
    setUserInput(e.target.value);
  };

  // --- Main Logic Handler ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!userInput.trim() || isLoading || !apiKeyEntered) return;

    const newUserMessage = { sender: 'user', text: userInput };
    setChatHistory(prev => [...prev, newUserMessage]);
    setUserInput('');
    setIsLoading(true);
    setError(null);

    try {
      // --- Call Gemini API ---
      // IMPORTANT: This uses the Gemini REST API directly from the frontend.
      // In a real-world app, this should be done via a secure backend proxy.
      const API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;

      // Build conversation history for the API call
      const messagesForApi = chatHistory
        .filter(msg => msg.sender === 'user' || msg.sender === 'ai') // Only user/ai messages
        .map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'model', // Map sender to API role
          parts: [{ text: msg.text }]
        }));
        
      // Add the current user message
      messagesForApi.push({ role: 'user', parts: [{ text: newUserMessage.text }] });

      const system_prompt = `You are a helpful medical assistant. Provide brief, conversational guidance (1-2 sentences). Identify the likely condition based on the user's message and history. Do NOT suggest specific medications directly in your response, as that will be handled separately. Focus on acknowledging symptoms and offering general advice or asking clarifying questions if needed. Example: "It sounds like you might have a cold. Rest and fluids are important."`;

      const requestBody = {
         contents: messagesForApi,
         generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 150,
         }
      };

      // Prepend system prompt (workaround for REST API)
      if (messagesForApi.length === 1) { // Only add for the first turn after API key
          requestBody.contents.unshift({ role: 'user', parts: [{ text: system_prompt }] });
      }

      console.log("Sending to Gemini:", JSON.stringify(requestBody, null, 2));

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("API Error Response:", errorData);
        throw new Error(`API Error (${response.status}): ${errorData?.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      console.log("Received from Gemini:", data);

      // Safely access the response text
      const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Sorry, I couldn't generate a response.";
      const aiMessage = { sender: 'ai', text: aiText };

      // --- Medication Logic ---
      // Extract condition based on user input and chat history
      const conditions = extractConditions(newUserMessage.text, chatHistory);
      let medicationInfo = null;
      if (conditions.length > 0) {
         // Use the first detected condition for simplicity
         medicationInfo = searchMedications(conditions[0]);
      }

      // Add medication info to the AI message if found
      if (medicationInfo) {
         aiMessage.medication = medicationInfo;
      }

      setChatHistory(prev => [...prev, aiMessage]);

    } catch (err) {
      console.error("Error:", err);
      setError(`Error: ${err.message || 'Failed to get response'}`);
      setChatHistory(prev => [...prev, { 
        sender: 'system', 
        text: `Error: ${err.message}`,
        error: true
      }]);
    } finally {
      setIsLoading(false);
    }
  };


  // --- Render ---
  return (
    <div className="app-container">
      {!apiKeyEntered ? (
        // API Key Input Screen
        <div className="api-key-container">
          <h1>AI Doctor</h1>
          <p>Please enter your Google Gemini API Key to begin:</p>
          <a href="https://makersuite.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="api-key-link">
              Get your API Key here
          </a>
          <input
            type="password" // Use password type for basic masking
            value={apiKey}
            onChange={handleApiKeyChange}
            onKeyDown={handleKeyDown}
            placeholder="Enter Gemini API Key"
            className="api-key-input"
          />
          <button onClick={handleApiKeySubmit} className="api-key-submit">
            Start Session
          </button>
          {error && <p className="error-message">{error}</p>}
          <p className="disclaimer">
             <span className="warning-icon">⚠️</span>
              Your API key is used directly in the browser and is not stored securely.
              This application is for demonstration purposes only. Do not use for sensitive medical information.
          </p>
        </div>
      ) : (
        // Chat Interface Screen
        <div className="chat-container">
          <header className="chat-header">
            <h1>AI Medical Assistant</h1>
            <p className="disclaimer-chat">
                <span className="warning-icon">⚠️</span>
                This is for informational purposes only. Consult a healthcare professional.
            </p>
          </header>

          <div className="chat-history">
            {chatHistory.map((msg, index) => (
              <React.Fragment key={index}>
                <div className={`message ${msg.sender} ${msg.error ? 'error' : ''}`}>
                  <span className="sender-label">{msg.sender === 'ai' ? 'AI Assistant' : msg.sender === 'user' ? 'You' : 'System'}</span>
                  <p>{msg.text}</p>
                </div>
                {msg.sender === 'ai' && msg.medication && (
                  <div className="medication-card">
                    <h4>Medicine Suggestion</h4>
                    <p><strong>Name:</strong> {msg.medication.name}</p>
                    <p><strong>Description:</strong> {msg.medication.description}</p>
                    <p><strong>Dosage:</strong> {msg.medication.dosage}</p>
                    <p><strong>Side Effects:</strong> {msg.medication.side_effects}</p>
                  </div>
                )}
              </React.Fragment>
            ))}
            {/* Loading Indicator */}
            {isLoading && (
              <div className="message loading">
                <span></span><span></span><span></span>
              </div>
            )}
            {/* Error Message */}
            {error && !isLoading && (
              <div className="message system error">{error}</div>
            )}
            {/* Invisible element to scroll to */}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="chat-input-form">
            <input
              type="text"
              value={userInput}
              onChange={handleInputChange}
              placeholder="Describe your symptoms..."
              disabled={isLoading}
              className="chat-input"
              ref={inputRef}
            />
            <button 
              type="submit" 
              disabled={isLoading || !userInput.trim()} 
              className="send-button"
              aria-label="Send message"
            >
              {isLoading ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
