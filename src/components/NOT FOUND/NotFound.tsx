import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Home, Mail, Sparkles, Compass, Zap, BadgeCheck } from 'lucide-react';

export default function Unauthorized() {
  const navigate = useNavigate();
  const [floatingElements, setFloatingElements] = useState([]);

  useEffect(() => {
    // Create floating elements for the background
    const elements = Array.from({ length: 6 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      delay: Math.random() * 4,
      duration: 4 + Math.random() * 2,
    }));
    setFloatingElements(elements);
  }, []);

  const handleContactAdmin = () => {
    console.log('Contact admin functionality');
  };

  const modules = [
    { name: "Dashboard", icon:'💎'},
    { name: "AI assistant", icon:'💎'},
    { name: "employees", icon:'💎' },
    { name: "leave management", icon:'💎' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-cyan-50 relative overflow-hidden">
      {/* Floating background elements */}
      {floatingElements.map((el) => (
        <div
          key={el.id}
          className="absolute w-4 h-4 bg-gradient-to-br from-indigo-200 to-cyan-200 rounded-full opacity-20"
          style={{
            left: `${el.x}%`,
            top: `${el.y}%`,
            animation: `float ${el.duration}s ease-in-out infinite ${el.delay}s alternate`,
          }}
        />
      ))}
      
      {/* Animated gradient orbs */}
      <div className="absolute top-20 left-20 w-72 h-72 bg-gradient-to-r from-green-100 to-blue-100 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
      <div className="absolute bottom-20 right-20 w-72 h-72 bg-gradient-to-r from-cyan-100 to-blue-100 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse" style={{animationDelay: '2s'}}></div>

      <div className="flex items-center justify-center min-h-screen p-4 relative z-10">
        <div className="max-w-lg w-full">
          {/* Main content card with glassmorphism effect */}
          <div className="backdrop-blur-xl bg-white/30 rounded-3xl border border-white/20 shadow-2xl p-8 text-center relative overflow-hidden">
            {/* Subtle gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent rounded-3xl"></div>
            
            {/* Content */}
            <div className="relative z-10">
              {/* Playful icon animation */}
              <div className="relative mb-8">
                <div className="relative mx-auto w-24 h-24 flex items-center justify-center">
                  <div className="absolute inset-0 bg-gradient-to-r from-indigo-400 to-cyan-400 rounded-full animate-spin" style={{animationDuration: '8s'}}></div>
                  <div className="absolute inset-1 bg-white rounded-full flex items-center justify-center">
                    <Sparkles className="h-10 w-10 text-indigo-500 animate-pulse" />
                  </div>
                </div>
                
                {/* Floating sparkles */}
                <div className="absolute top-0 left-0 w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{animationDelay: '0.5s'}}></div>
                <div className="absolute top-4 right-2 w-1.5 h-1.5 bg-pink-400 rounded-full animate-bounce" style={{animationDelay: '1s'}}></div>
                <div className="absolute bottom-2 left-4 w-1 h-1 bg-cyan-400 rounded-full animate-bounce" style={{animationDelay: '1.5s'}}></div>
              </div>
              
              {/* Friendly messaging */}
              <div className="space-y-6">
                <div>
                  <h1 className="text-3xl font-light text-gray-800 mb-2">
                    Almost there! 👋
                  </h1>
                  <p className="text-gray-600 text-lg font-light leading-relaxed max-w-sm mx-auto">
                    This module is unavailable for now. While we're sprucing things up, why not explore what's available?
                  </p>
                </div>

                {/* Available modules showcase */}
                <div className="bg-white/40 rounded-2xl p-6 backdrop-blur-sm border border-white/30">
                  <h3 className="text-xs font-medium text-gray-700 mb-4 flex items-center justify-center gap-2">
                    <Compass className="h-4 w-4" />
                    Available to explore
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {modules.map((module, index) => (
                      <div
                        key={module.name}
                        className="flex items-center gap-2 p-3 bg-white/60 rounded-xl hover:bg-white/80 transition-all duration-300 cursor-pointer hover:scale-105 hover:shadow-lg group"
                        style={{animationDelay: `${index * 0.1}s`}}
                      >
                        <span className="text-lg group-hover:scale-110 transition-transform duration-200">
                          {module.icon}
                        </span>
                        <span className="text-xs font-medium text-gray-700">
                          {module.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Action buttons */}
                <div className="pt-4 flex flex-col gap-4">
                  <button
                    onClick={() => navigate('/')}
                    className="group relative px-8 py-4 bg-gradient-to-r from-indigo-500 to-cyan-500 text-white font-medium rounded-2xl overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-2xl"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-cyan-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="relative flex items-center justify-center gap-2">
                      <Home className="h-5 w-5 group-hover:rotate-12 transition-transform duration-300" />
                      Take me home
                    </div>
                  </button>
                  
                  
                </div>
              </div>
            </div>
          </div>
          
          {/* Subtle footer */}
          <div className="mt-8 text-center">
            <p className="text-xs text-gray-400 flex items-center justify-center gap-1">
              <Zap className="h-3 w-3" />
              Powered by figbud global
            </p>
          </div>
        </div>
      </div>
      
      <style jsx>{`
        @keyframes float {
          0% { transform: translateY(0px) rotate(0deg); }
          100% { transform: translateY(-20px) rotate(360deg); }
        }
      `}</style>
    </div>
  );
}