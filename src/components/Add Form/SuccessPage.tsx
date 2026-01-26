import { motion } from 'framer-motion';
import { Check, PartyPopper, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import GlowButton from '../UI/GlowButton';

const SuccessPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const employeeNumber = location.state?.employeeNumber;
  const employeeName = location.state?.employeeName;
  const [isPageLoading, setIsPageLoading] = useState(true);

  useEffect(() => {
    // Scroll to top when component mounts
    window.scrollTo(0, 0);

    // Add a delay before showing the page content
    const timer = setTimeout(() => {
      setIsPageLoading(false);
    }, 1000); // 1 second delay

    return () => clearTimeout(timer);
  }, []);

  const handleSendContract = () => {
    // Implement contract sending logic here
    alert(`Contract link would be sent for employee ${employeeNumber}`);
  };

  if (isPageLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <motion.div
          animate={{ 
            rotate: 360,
            scale: [1, 1.2, 1]
          }}
          transition={{ 
            duration: 1,
            repeat: Infinity,
            ease: "linear"
          }}
          className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="p-4 md:p-6 max-w-4xl mx-auto text-center"
    >
      <motion.div
        initial={{ scale: 0.8, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 100 }}
        className="bg-white rounded-xl shadow-lg border border-gray-300 overflow-hidden p-8 md:p-12"
      >
        {/* Confetti animation container */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(30)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: -100, x: Math.random() * 100 - 50 }}
              animate={{
                opacity: [0, 1, 0],
                y: [0, Math.random() * 200 + 100],
                x: Math.random() * 200 - 100,
                rotate: Math.random() * 360
              }}
              transition={{
                duration: 2 + Math.random() * 3,
                delay: Math.random() * 0.5,
                repeat: Infinity,
                repeatDelay: Math.random() * 5
              }}
              className="absolute text-yellow-400"
              style={{
                top: -50,
                left: `${Math.random() * 100}%`,
              }}
            >
              <PartyPopper className="w-5 h-5" />
            </motion.div>
          ))}
        </div>

        <div className="relative z-10">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2 }}
            className="mx-auto flex items-center justify-center h-24 w-24 rounded-full bg-emerald-100 mb-6"
          >
            <Check className="h-12 w-12 text-emerald-600" />
          </motion.div>

          <motion.h1 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-3xl font-bold text-gray-900 mb-2"
          >
            Employee Added Successfully!
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-gray-600 mb-8 max-w-md mx-auto"
          >
            {employeeName} has been successfully added to the system with employee number{' '}
            <span className="font-semibold text-emerald-600">{employeeNumber}</span>.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="flex flex-col sm:flex-row justify-center gap-4"
          >
            <GlowButton
              onClick={() => navigate('/employees')}
              className="bg-gray-100 hover:bg-gray-200 text-gray-800"
            >
              Back to Employees
            </GlowButton>
            
            <GlowButton
              onClick={handleSendContract}
              icon={Send}
              className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white"
            >
              Send Contract Link
            </GlowButton>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default SuccessPage;