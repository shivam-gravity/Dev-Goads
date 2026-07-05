import { FormEvent, useState } from "react";
import SiteNav from "../components/SiteNav.js";
import SiteFooter from "../components/SiteFooter.js";
import BackToTop from "../components/BackToTop.js";
import Reveal from "../components/Reveal.js";

export default function Contact() {
  const [sent, setSent] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSent(true);
  }

  return (
    <div className="landing">
      <SiteNav />
      <section className="hero hero-compact">
        <span className="eyebrow">Contact</span>
        <h1>Get in touch</h1>
        <p className="lead">
          Questions about the product or pricing? Send a note, or email{" "}
          <a href="mailto:hello@example.com" className="faq-contact-link">hello@example.com</a> directly.
        </p>
      </section>

      <section className="section">
        <Reveal>
          <div className="card contact-card">
            {sent ? (
              <p>Thanks — this is a demo form, so nothing was actually sent, but in production this would reach the team.</p>
            ) : (
              <form onSubmit={handleSubmit} className="form">
                <label>
                  Name
                  <input value={name} onChange={(e) => setName(e.target.value)} required />
                </label>
                <label>
                  Email
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <label>
                  Message
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={5}
                    required
                    className="contact-textarea"
                  />
                </label>
                <button type="submit" className="btn btn-primary">Send message</button>
              </form>
            )}
          </div>
        </Reveal>
      </section>

      <BackToTop />

      <SiteFooter />
    </div>
  );
}
