// src/components/Layout/Footer.tsx
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const Footer = () => {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  useEffect(() => {
    const interval = setInterval(() => {
      const newYear = new Date().getFullYear();
      if (newYear !== currentYear) {
        setCurrentYear(newYear);
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [currentYear]);

  return (
    <motion.footer
      className="mx-4 mb-4 relative z-10"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Floating Container with Curved Edges - Premium Glassmorphism */}
      <motion.div
        className="relative px-6 py-4 bg-white/80 backdrop-blur-xl rounded-[24px] shadow-sm border border-white/50"
        whileHover={{
          y: -2,
          transition: { duration: 0.2 }
        }}
      >
        <div className="px-6 py-6">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-4 mb-4 md:mb-0">
              <motion.span
                className="text-gray-900 text-xs font-medium"
                style={{ fontFamily: "'Avenir Next', sans-serif" }}
                whileHover={{ scale: 1.05 }}
              >
                © {currentYear} Figbud Global
              </motion.span>
              <div className="hidden sm:block h-4 w-px bg-gray-900/30"></div>
              <motion.span
                className="text-gray-900 font-semibold text-xs"
                style={{ fontFamily: "'Avenir Next', sans-serif" }}
                whileHover={{ scale: 1.05 }}
              >
                Automation Moraans
              </motion.span>
            </div>

            <div className="flex items-center space-x-6">
              <motion.a
                href="#"
                className="text-gray-900 hover:text-gray-700 transition-colors duration-200 text-xs font-medium"
                style={{ fontFamily: "'Avenir Next', sans-serif" }}
                whileHover={{
                  scale: 1.05,
                  y: -1
                }}
                whileTap={{ scale: 0.95 }}
              >
                Privacy Policy
              </motion.a>
              <motion.a
                href="#"
                className="text-gray-900 hover:text-gray-700 transition-colors duration-200 text-xs font-medium"
                style={{ fontFamily: "'Avenir Next', sans-serif" }}
                whileHover={{
                  scale: 1.05,
                  y: -1
                }}
                whileTap={{ scale: 0.95 }}
              >
                Terms of Service
              </motion.a>
            </div>
          </div>

          <motion.div
            className="mt-4 text-center md:text-left"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <p
              className="text-xs text-gray-900/80 font-medium"
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              Simplifying automation solutions for modern businesses
            </p>
          </motion.div>
        </div>

        {/* Decorative Elements */}
        <div className="absolute top-0 left-6 w-20 h-1 bg-gradient-to-r from-transparent via-white/30 to-transparent rounded-full"></div>
        <div className="absolute bottom-0 right-6 w-16 h-1 bg-gradient-to-r from-transparent via-white/30 to-transparent rounded-full"></div>
      </motion.div>

      {/* Subtle Floating Effect */}
      <motion.div
        className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/20 to-transparent pointer-events-none"
        animate={{
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
    </motion.footer>
  );
};

export default Footer;