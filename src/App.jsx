import { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, query, addDoc, updateDoc, deleteDoc, getDocs, where, orderBy, limit } from 'firebase/firestore';

export default function App() {
  // --- State Management ---
  const [searchQuery, setSearchQuery] = useState('');
  const [podcasts, setPodcasts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);
  const [db, setDb] = useState(null);
  const [ratings, setRatings] = useState({});
  const [episodeRatings, setEpisodeRatings] = useState({});
  const [myRatings, setMyRatings] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [selectedPodcast, setSelectedPodcast] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [currentView, setCurrentView] = useState('home'); // 'home', 'my-ratings', 'podcast-details'
  const [currentHomepageSection, setCurrentHomepageSection] = useState('top-rated'); // 'top-rated', 'trending', 'hidden-gems'
  const [showRatingsModal, setShowRatingsModal] = useState(false);
  const [modalType, setModalType] = useState('review'); // 'review', 'ratings'
  const [currentPodcastToReview, setCurrentPodcastToReview] = useState(null);
  const [reviews, setReviews] = useState({});
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Hardcoded categories and languages
  const categories = ['All', 'News', 'Comedy', 'Technology', 'Sports', 'Education', 'Health', 'Science', 'Arts', 'Business'];
  const languages = ['en', 'es', 'fr', 'de', 'ja'];
  
  // Your Listen Notes API key
  const apiKey = "6abb7220245c44f3b90c4bffd73e44a5";

  // --- Firebase Initialization and Authentication ---
  useEffect(() => {
    // Global variables from the Canvas environment
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
    const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : undefined;

    // Load custom fonts
    const loadFonts = () => {
      const link = document.createElement('link');
      link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Playfair+Display:wght@700&display=swap';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    };
    loadFonts();

    let app;
    let dbInstance;
    let auth;
    let unsubscribeAuth = () => {};
    let unsubscribeRatings = () => {};
    let unsubscribeEpisodeRatings = () => {};

    if (Object.keys(firebaseConfig).length > 0) {
      try {
        app = initializeApp(firebaseConfig);
        dbInstance = getFirestore(app);
        auth = getAuth(app);
        setDb(dbInstance);

        // Authenticate the user
        const authenticate = async () => {
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(auth, initialAuthToken);
            } else {
              await signInAnonymously(auth);
            }
          } catch (err) {
            console.error("Firebase authentication failed:", err);
            setError("Failed to authenticate with Firebase.");
            setIsAuthReady(true);
          }
        };
        authenticate();

        // Listen for auth state changes
        unsubscribeAuth = onAuthStateChanged(auth, (user) => {
          if (user) {
            setUserId(user.uid);
            
            // Set up real-time ratings listener
            const ratingsCollectionPath = `artifacts/${appId}/public/data/ratings`;
            const ratingsQuery = query(collection(dbInstance, ratingsCollectionPath));
            unsubscribeRatings = onSnapshot(ratingsQuery, (snapshot) => {
              const allRatings = {};
              snapshot.forEach(doc => {
                const data = doc.data();
                const { podcastId, rating, userId: ratingUserId, timestamp } = data;
                if (!allRatings[podcastId]) {
                  allRatings[podcastId] = { totalRating: 0, count: 0, userRated: false, recentRatings: 0, ratings: [] };
                }
                allRatings[podcastId].totalRating += rating;
                allRatings[podcastId].count += 1;
                allRatings[podcastId].ratings.push({ rating, timestamp });
                if (ratingUserId === user.uid) {
                  allRatings[podcastId].userRated = true;
                }
              });
              setRatings(allRatings);
            }, (err) => {
              console.error("Firestore snapshot error:", err);
              setError("Failed to fetch ratings from the database.");
            });

          } else {
            // Use a random ID for anonymous users
            setUserId(crypto.randomUUID());
          }
          setIsAuthReady(true);
        });

      } catch (err) {
        console.error("Firebase initialization failed:", err);
        setError("Firebase is not configured. Please ensure the app is running in a compatible environment.");
        setIsAuthReady(true);
      }
    } else {
      setError("Firebase is not configured. Please ensure the app is running in a compatible environment.");
      setIsAuthReady(true);
    }

    // Cleanup function for the listeners
    return () => {
      unsubscribeAuth();
      unsubscribeRatings();
      unsubscribeEpisodeRatings();
    };
  }, []);

  // --- Fetching Logic for different sections ---
  useEffect(() => {
    if (isAuthReady && db) {
      if (currentView === 'home') {
        fetchHomepageContent(currentHomepageSection);
      } else if (currentView === 'my-ratings') {
        fetchMyRatings();
      }
    }
  }, [isAuthReady, db, currentView, currentHomepageSection, ratings, selectedCategory, selectedLanguage]);

  const fetchHomepageContent = async (section) => {
    setLoading(true);
    setError(null);
    setPodcasts([]);
    
    // Sort and filter the ratings based on the selected section and filters
    const allPodcastRatings = Object.entries(ratings).map(([podcastId, data]) => ({
      podcastId,
      average: data.totalRating / data.count,
      count: data.count,
      recentCount: data.ratings.filter(r => (new Date() - new Date(r.timestamp?.toDate())) < 7 * 24 * 60 * 60 * 1000).length // ratings in last 7 days
    }));

    let filteredPodcastIds = [];
    if (section === 'top-rated') {
      filteredPodcastIds = allPodcastRatings
        .filter(p => p.count > 0)
        .sort((a, b) => b.average - a.average);
    } else if (section === 'trending') {
      filteredPodcastIds = allPodcastRatings
        .filter(p => p.recentCount > 0)
        .sort((a, b) => b.recentCount - a.recentCount);
    } else if (section === 'hidden-gems') {
      filteredPodcastIds = allPodcastRatings
        .filter(p => p.average >= 4.5 && p.count > 0 && p.count <= 10)
        .sort((a, b) => b.average - a.average);
    }

    try {
      let podcastsData = [];
      if (filteredPodcastIds.length > 0) {
        podcastsData = await Promise.all(
          filteredPodcastIds.slice(0, 100).map(async (p) => {
            const apiUrl = `https://listen-api.listennotes.com/api/v2/podcasts/${p.podcastId}`;
            const response = await fetch(apiUrl, {
              method: 'GET',
              headers: { 'X-ListenAPI-Key': apiKey },
            });
            if (!response.ok) {
              console.error(`API call failed for podcast ${p.podcastId}`);
              return null;
            }
            const data = await response.json();
            return data;
          })
        );
      } else {
        // Fallback for new users or no data: fetch a random set of podcasts
        const fallbackApiUrl = `https://listen-api.listennotes.com/api/v2/just_listen`;
        const response = await fetch(fallbackApiUrl, {
          method: 'GET',
          headers: { 'X-ListenAPI-Key': apiKey },
        });
        if (!response.ok) {
          throw new Error(`Fallback API call failed with status: ${response.status}`);
        }
        const data = await response.json();
        podcastsData.push(data);
        console.log("Using fallback podcasts due to no ratings data.");
        // Clear previous error if fallback is successful
        setError(null);
      }

      const validPodcasts = podcastsData.filter(p => p !== null);
      
      // Apply category and language filters
      const filteredResults = validPodcasts.filter(p => {
        const matchesCategory = selectedCategory === 'All' || (p.genres && p.genres.some(genre => genre.toLowerCase().includes(selectedCategory.toLowerCase())));
        const matchesLanguage = selectedLanguage === 'en' || p.language.startsWith(selectedLanguage);
        return matchesCategory && matchesLanguage;
      });

      setPodcasts(filteredResults);
      if (filteredResults.length === 0) {
        setError(`No ${section.replace('-', ' ')} podcasts found with the selected filters.`);
      }
    } catch (err) {
      console.error("Fetch error:", err);
      setError("Failed to fetch podcasts. Please check your network connection.");
    } finally {
      setLoading(false);
    }
  };

  const fetchMyRatings = async () => {
    setLoading(true);
    setError(null);
    setMyRatings([]);

    if (!userId || !db) {
      setLoading(false);
      return;
    }

    try {
      const ratingsCollectionPath = `artifacts/${__app_id}/public/data/ratings`;
      // Corrected query to use `where`
      const q = query(collection(db, ratingsCollectionPath), where("userId", "==", userId));
      const snapshot = await getDocs(q);

      const ratedPodcastIds = snapshot.docs.map(doc => doc.data().podcastId);
      const uniquePodcastIds = [...new Set(ratedPodcastIds)];

      const podcastsData = await Promise.all(
        uniquePodcastIds.map(async (id) => {
          const apiUrl = `https://listen-api.listennotes.com/api/v2/podcasts/${id}`;
          const response = await fetch(apiUrl, {
            method: 'GET',
            headers: { 'X-ListenAPI-Key': apiKey },
          });
          if (!response.ok) {
            console.error(`API call failed for podcast ${id}`);
            return null;
          }
          const data = await response.json();
          return data;
        })
      );

      setMyRatings(podcastsData.filter(p => p !== null));
      if (podcastsData.filter(p => p !== null).length === 0) {
        setError("You haven't rated any podcasts yet.");
      }
    } catch (err) {
      console.error("Fetch my ratings error:", err);
      setError("Failed to fetch your ratings.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;
    setLoading(true);
    setError(null);
    setPodcasts([]);
    setCurrentView('home');
    setCurrentHomepageSection('search-results');
    
    try {
      const apiUrl = `https://listen-api.listennotes.com/api/v2/search?q=${encodeURIComponent(searchQuery)}&type=podcast`;
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'X-ListenAPI-Key': apiKey },
      });
      if (!response.ok) {
        throw new Error(`API call failed with status: ${response.status}`);
      }
      const data = await response.json();
      setPodcasts(data.results);
      if (data.results.length === 0) {
        setError("No podcasts found. Try a different search term.");
      }
    } catch (err) {
      console.error("Search fetch error:", err);
      setError("Failed to search. Please check your network connection.");
    } finally {
      setLoading(false);
    }
  };

  const fetchEpisodes = async (podcast) => {
    setEpisodesLoading(true);
    setEpisodes([]);
    setSelectedPodcast(podcast);
    setCurrentView('podcast-details');
    
    try {
      const apiUrl = `https://listen-api.listennotes.com/api/v2/podcasts/${podcast.id}`;
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'X-ListenAPI-Key': apiKey },
      });
      if (!response.ok) {
        throw new Error(`API call failed with status: ${response.status}`);
      }
      const data = await response.json();
      setEpisodes(data.episodes);
    } catch (err) {
      console.error("Fetch episodes error:", err);
      setError("Failed to fetch episodes. Please try again later.");
    } finally {
      setEpisodesLoading(false);
    }
  };

  // --- Rating and Review System ---
  const handleRating = async (id, ratingValue, type) => {
    if (!userId || !db) {
      setError("You must be authenticated to submit a rating.");
      return;
    }

    const collectionPath = `artifacts/${__app_id}/public/data/ratings`;

    try {
      // Corrected query to use `where` clauses for efficiency
      const q = query(collection(db, collectionPath), where("podcastId", "==", id), where("userId", "==", userId));
      const snapshot = await getDocs(q);
      let existingRatingDoc = null;
      if (!snapshot.empty) {
        existingRatingDoc = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
      }

      if (existingRatingDoc) {
        const ratingDocRef = doc(db, collectionPath, existingRatingDoc.id);
        await updateDoc(ratingDocRef, { rating: ratingValue });
      } else {
        const newRatingData = {
          podcastId: id,
          userId: userId,
          rating: ratingValue,
          timestamp: new Date()
        };
        await addDoc(collection(db, collectionPath), newRatingData);
      }
    } catch (e) {
      console.error("Error submitting rating:", e);
      setError("Failed to submit rating. Please try again.");
    }
  };

  const handleReviewSubmit = async (podcastId, reviewText) => {
    if (!userId || !db) {
        setError("You must be authenticated to submit a review.");
        return;
    }
    if (reviewText.trim() === "") {
        setError("Review cannot be empty.");
        return;
    }

    const reviewsCollectionPath = `artifacts/${__app_id}/public/data/reviews`;
    
    try {
        await addDoc(collection(db, reviewsCollectionPath), {
            podcastId,
            userId,
            reviewText,
            timestamp: new Date()
        });
        // Clear the review input and close the modal
        setShowRatingsModal(false);
    } catch (e) {
        console.error("Error submitting review:", e);
        setError("Failed to submit review. Please try again.");
    }
  };


  // --- Helper functions for rendering ---
  const renderStars = (id) => {
    const podcastRatings = ratings[id];
    const averageRating = podcastRatings ? podcastRatings.totalRating / podcastRatings.count : 0;
    const fullStars = Math.floor(averageRating);
    const hasHalfStar = averageRating - fullStars >= 0.5;

    const stars = [];
    for (let i = 1; i <= 5; i++) {
      let starClass = "text-gray-400";
      if (i <= fullStars) {
        starClass = "text-[#FFD700]";
      } else if (hasHalfStar && i === fullStars + 1) {
        starClass = "text-[#FFD700] opacity-50";
      }

      stars.push(
        <span
          key={i}
          className={`h-6 w-6 cursor-pointer transition-colors duration-200 ${starClass}`}
          onClick={(e) => {
            e.stopPropagation(); // Prevent navigating to podcast details
            handleRating(id, i, 'podcast');
          }}
          title={`Rate ${i} star${i > 1 ? 's' : ''}`}
        >
          &#9733;
        </span>
      );
    }
    return (
        <div className="flex items-center space-x-1">
            {stars}
            <span className="text-sm font-semibold text-[#FFD700] ml-1">
                ({averageRating.toFixed(1)})
            </span>
        </div>
    );
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex justify-center items-center h-full">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-[#D4AF37]"></div>
        </div>
      );
    }
    
    if (error) {
      return (
        <div className="bg-red-600 p-4 rounded-lg text-white text-center font-semibold mt-8 shadow-lg max-w-xl mx-auto">
          {error}
        </div>
      );
    }
    
    if (currentView === 'podcast-details') {
      return (
        <div className="w-full max-w-4xl mx-auto">
          <div className="flex items-center mb-6">
            <button
              onClick={() => setCurrentView('home')}
              className="p-2 bg-[#D4AF37] text-[#1A202C] font-bold rounded-lg hover:bg-[#C2A53D] transition-all duration-300 shadow-lg active:scale-95 transform"
            >
              Back to Home
            </button>
            <h1 className="text-3xl font-bold text-[#D4AF37] text-center flex-grow font-playfair-display">
              {selectedPodcast.title_original}
            </h1>
          </div>
          {/* Main Podcast Info Section */}
          <div className="bg-[#2D3748] rounded-xl p-6 shadow-2xl flex flex-col md:flex-row items-center md:items-start gap-6 mb-8">
            <img 
                src={selectedPodcast.image} 
                alt={selectedPodcast.title_original} 
                className="w-48 h-48 rounded-xl object-cover shadow-lg" 
                onError={(e) => { e.target.src = `https://placehold.co/200x200/1f2937/d1d5db?text=No+Image`; }}
            />
            <div className="flex-1">
                <p className="text-gray-400 text-sm mb-2">{selectedPodcast.publisher_original}</p>
                <p className="text-gray-300 text-sm mb-4 line-clamp-4">{selectedPodcast.description_original}</p>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2">
                        <span className="text-lg font-bold text-[#D4AF37]">Rating:</span>
                        {renderStars(selectedPodcast.id)}
                    </div>
                    <button
                        onClick={() => {
                            setCurrentPodcastToReview(selectedPodcast);
                            setModalType('review');
                            setShowRatingsModal(true);
                        }}
                        className="p-2 bg-[#D4AF37] text-[#1A202C] font-bold rounded-lg hover:bg-[#C2A53D] transition-all duration-300 shadow-lg active:scale-95 transform"
                    >
                        Write a Review
                    </button>
                </div>
            </div>
          </div>

          {/* Episode List */}
          <h2 className="text-2xl font-bold text-[#D4AF37] mb-4 font-playfair-display">Episodes</h2>
          {episodes.map((episode) => (
            <div key={episode.id} className="bg-[#2D3748] p-4 rounded-xl shadow-md mb-4 flex items-center gap-4">
              <img 
                src={episode.image} 
                alt={episode.title} 
                className="w-20 h-20 object-cover rounded-lg flex-shrink-0"
                onError={(e) => { e.target.src = `https://placehold.co/80x80/1f2937/d1d5db?text=No+Image`; }}
              />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white mb-1 font-playfair-display">{episode.title}</h3>
                <p className="text-sm text-[#A0AEC0] mb-2">{new Date(episode.pub_date_ms).toLocaleDateString()}</p>
                <p className="text-sm text-gray-400 line-clamp-2">{episode.description}</p>
              </div>
            </div>
          ))}
        </div>
      );
    }
    
    if (currentView === 'my-ratings') {
      return (
        <div className="w-full max-w-4xl mx-auto">
          <h1 className="text-3xl sm:text-5xl font-bold text-center my-8 text-[#D4AF37] font-playfair-display">My Rated Podcasts</h1>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {myRatings.length > 0 ? myRatings.map((podcast) => (
                <div 
                    key={podcast.id} 
                    className="bg-[#2D3748] rounded-xl overflow-hidden shadow-lg p-4"
                >
                    <img 
                        src={podcast.image} 
                        alt={podcast.title_original} 
                        className="w-full h-48 object-cover rounded-lg mb-4"
                        onError={(e) => { e.target.src = `https://placehold.co/400x400/1f2937/d1d5db?text=No+Image`; }}
                    />
                    <h2 className="text-xl font-bold text-white mb-2 font-playfair-display">{podcast.title_original}</h2>
                    <div className="flex items-center space-x-2 mt-4">
                        {renderStars(podcast.id)}
                    </div>
                </div>
            )) : <p className="text-center text-gray-400 col-span-full">You haven't rated any podcasts yet.</p>}
          </div>
        </div>
      );
    }

    // Default 'home' view
    return (
      <div className="w-full max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center gap-4 my-8">
            <h1 className="text-3xl sm:text-5xl font-bold text-[#D4AF37] font-playfair-display whitespace-nowrap">
                {currentHomepageSection === 'top-rated' && 'Top 100 Rated'}
                {currentHomepageSection === 'trending' && 'Trending Now'}
                {currentHomepageSection === 'hidden-gems' && 'Hidden Gems'}
                {currentHomepageSection === 'search-results' && 'Search Results'}
            </h1>
            <div className="flex-1 w-full sm:w-auto">
                <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-4 w-full">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search for a podcast..."
                      className="flex-grow p-3 rounded-lg bg-[#2D3748] border-2 border-[#4A5568] focus:outline-none focus:border-[#D4AF37] text-lg text-white placeholder-gray-400 shadow-md transition-all duration-300"
                    />
                    <button
                      type="submit"
                      className="p-3 bg-[#D4AF37] text-[#1A202C] font-bold rounded-lg hover:bg-[#C2A53D] transition-colors duration-300 shadow-md active:scale-95 transform disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={loading}
                    >
                      Search
                    </button>
                </form>
            </div>
        </div>
        
        {/* User ID for Firestore */}
        {userId && (
          <div className="text-sm text-[#A0AEC0] text-center mb-4">
            Your User ID for Ratings: **`{userId}`**
          </div>
        )}

        {/* Filters and Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8 p-4 bg-[#2D3748] rounded-xl shadow-inner">
            <div className="flex flex-wrap gap-2 sm:gap-4">
                <button
                    onClick={() => setCurrentHomepageSection('top-rated')}
                    className={`py-2 px-4 rounded-full font-bold transition-all duration-300 ${currentHomepageSection === 'top-rated' ? 'bg-[#D4AF37] text-[#1A202C]' : 'bg-[#4A5568] text-[#E2E8F0] hover:bg-[#6A788A]'}`}
                >
                    Top Rated
                </button>
                <button
                    onClick={() => setCurrentHomepageSection('trending')}
                    className={`py-2 px-4 rounded-full font-bold transition-all duration-300 ${currentHomepageSection === 'trending' ? 'bg-[#D4AF37] text-[#1A202C]' : 'bg-[#4A5568] text-[#E2E8F0] hover:bg-[#6A788A]'}`}
                >
                    Trending
                </button>
                <button
                    onClick={() => setCurrentHomepageSection('hidden-gems')}
                    className={`py-2 px-4 rounded-full font-bold transition-all duration-300 ${currentHomepageSection === 'hidden-gems' ? 'bg-[#D4AF37] text-[#1A202C]' : 'bg-[#4A5568] text-[#E2E8F0] hover:bg-[#6A788A]'}`}
                >
                    Hidden Gems
                </button>
            </div>
            
            <div className="flex items-center gap-4 flex-wrap">
                <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="p-2 rounded-lg bg-[#4A5568] text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                >
                    {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <select
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value)}
                    className="p-2 rounded-lg bg-[#4A5568] text-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                >
                    {languages.map(lang => <option key={lang} value={lang}>{lang.toUpperCase()}</option>)}
                </select>
            </div>
        </div>

        {/* Podcast Grid */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {podcasts.map((podcast) => (
            <div
              key={podcast.id}
              className={`bg-[#2D3748] rounded-xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 group cursor-pointer
              ${ratings[podcast.id]?.userRated ? 'ring-2 ring-[#FFD700]' : ''}`}
              onClick={() => fetchEpisodes(podcast)}
            >
              <div className="relative">
                <img
                  src={podcast.image}
                  alt={podcast.title_original}
                  className="w-full h-48 object-cover"
                  onError={(e) => { e.target.src = `https://placehold.co/400x400/1f2937/d1d5db?text=No+Image`; }}
                />
              </div>
              <div className="p-4">
                <h2 className="text-xl font-bold text-white mb-2 font-playfair-display">{podcast.title_original}</h2>
                <p className="text-[#A0AEC0] text-sm line-clamp-3">{podcast.description_original}</p>
                <div className="mt-4 flex flex-col justify-between items-start text-sm text-[#A0AEC0] gap-2">
                  <span className="bg-[#D4AF37] rounded-full px-2 py-1 text-xs text-[#1A202C] font-semibold">{podcast.language}</span>
                  {renderStars(podcast.id)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Main App Component Structure
  return (
    <div className="min-h-screen bg-[#1A202C] text-[#E2E8F0] flex flex-col font-inter">
      {/* Top Navigation */}
      <nav className="bg-[#2D3748] p-4 flex flex-col sm:flex-row items-center justify-between border-b border-[#4A5568]">
        <h1 className="text-3xl font-bold text-[#D4AF37] mb-2 sm:mb-0 font-playfair-display">PodVibe</h1>
        <div className="flex flex-wrap gap-4 text-white">
          <button
            onClick={() => setCurrentView('home')}
            className={`py-2 px-4 rounded-lg transition-all duration-300 ${currentView === 'home' ? 'bg-[#D4AF37] text-[#1A202C] font-bold shadow-md' : 'hover:bg-[#4A5568]'}`}
          >
            Home
          </button>
          <button
            onClick={() => setCurrentView('my-ratings')}
            className={`py-2 px-4 rounded-lg transition-all duration-300 ${currentView === 'my-ratings' ? 'bg-[#D4AF37] text-[#1A202C] font-bold shadow-md' : 'hover:bg-[#4A5568]'}`}
          >
            My Ratings
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="flex-grow p-4 sm:p-8">
        {renderContent()}
      </div>
    </div>
  );
}
