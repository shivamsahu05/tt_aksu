import React, { forwardRef } from 'react';
import logo from '../../assets/logo.png';

const InternalTestReport = forwardRef(({ testData }, ref) => {
    if (!testData) return null;

    // Helper to format date
    const formatDate = (dateString) => {
        if (!dateString) return '';
        const d = new Date(dateString);
        return d.toLocaleDateString('en-GB'); // dd/mm/yyyy
    };

    // Helper to get Day of the week
    const getDayName = (dateString) => {
        if (!dateString) return '';
        const d = new Date(dateString);
        return d.toLocaleDateString('en-GB', { weekday: 'long' });
    };

    // Helper to get Exam Notice Month & Year (e.g. AUGUST-2026)
    const getNoticeMonthYear = (dateString) => {
        if (!dateString) return '';
        const d = new Date(dateString);
        const month = d.toLocaleDateString('en-GB', { month: 'long' }).toUpperCase();
        const year = d.getFullYear();
        return `${month}-${year}`;
    };

    const isOnline = testData.test_type === 'Online Class Test' || testData.test_type === 'Online Class Retest';
    const reportDate = new Date().toLocaleDateString('en-GB');
    const noticeMonthYear = getNoticeMonthYear(testData.test_date);

    return (
        <div ref={ref} style={{ padding: '40px', backgroundColor: '#fff', color: '#000', fontFamily: 'Arial, sans-serif', width: '210mm', minHeight: '297mm', margin: '0 auto', boxSizing: 'border-box' }}>
            
            {/* Header Section */}
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '3px solid #002147', paddingBottom: '15px', marginBottom: '20px' }}>
                <img src={logo} alt="University Logo" style={{ width: '100px', height: '100px', objectFit: 'contain' }} />
                <div style={{ flex: 1, textAlign: 'center' }}>
                    <h1 style={{ margin: '0', fontSize: '28px', color: '#002147', fontWeight: 'bold', textTransform: 'uppercase' }}>AKS University, Satna</h1>
                    <h2 style={{ margin: '5px 0 0 0', fontSize: '20px', color: '#444' }}>Department of {testData.department_name || 'Computer Science and Engineering'}</h2>
                </div>
            </div>

            {/* Exam Notice Title */}
            <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                <h3 style={{ margin: '0', fontSize: '24px', textDecoration: 'underline', color: '#b30000', fontWeight: 'bold' }}>EXAM NOTICE</h3>
                <h4 style={{ margin: '5px 0 0 0', fontSize: '18px', color: '#333' }}>{testData.test_type?.toUpperCase() || 'INTERNAL EXAM'} ({noticeMonthYear})</h4>
            </div>

            {/* Meta Information */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '25px', fontSize: '14px', fontWeight: 'bold' }}>
                <div>Ref No: <span style={{ fontWeight: 'normal' }}>{testData.ref_id || 'N/A'}</span></div>
                <div>Date: <span style={{ fontWeight: 'normal' }}>{reportDate}</span></div>
            </div>

            {/* Introductory Text */}
            <p style={{ fontSize: '15px', lineHeight: '1.6', marginBottom: '25px' }}>
                This is to notify that the <strong>{testData.test_type || 'Internal Test'}</strong> for <strong>{testData.class_name}</strong> will be conducted as per the following schedule. All concerned students and invigilators must strictly adhere to the timings.
            </p>

            {/* Schedule Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '40px', fontSize: '14px' }}>
                <thead>
                    <tr style={{ backgroundColor: '#002147', color: '#fff', textAlign: 'left' }}>
                        <th style={{ padding: '10px', border: '1px solid #ccc' }}>S.No.</th>
                        <th style={{ padding: '10px', border: '1px solid #ccc' }}>Class</th>
                        <th style={{ padding: '10px', border: '1px solid #ccc' }}>Date & Day</th>
                        <th style={{ padding: '10px', border: '1px solid #ccc' }}>Timing</th>
                        <th style={{ padding: '10px', border: '1px solid #ccc' }}>Subject</th>
                        <th style={{ padding: '10px', border: '1px solid #ccc' }}>Room / Lab</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style={{ padding: '10px', border: '1px solid #ccc', textAlign: 'center' }}>1</td>
                        <td style={{ padding: '10px', border: '1px solid #ccc' }}>{testData.class_name}</td>
                        <td style={{ padding: '10px', border: '1px solid #ccc' }}>{formatDate(testData.test_date)}<br/><small>{getDayName(testData.test_date)}</small></td>
                        <td style={{ padding: '10px', border: '1px solid #ccc', whiteSpace: 'nowrap' }}>{testData.start_time} - {testData.end_time}</td>
                        <td style={{ padding: '10px', border: '1px solid #ccc' }}>{testData.subject_name}<br/><small>({testData.subject_code || 'N/A'})</small></td>
                        <td style={{ padding: '10px', border: '1px solid #ccc' }}>{testData.rooms || 'TBA'}</td>
                    </tr>
                </tbody>
            </table>

            {/* Important Instructions (Optional but professional) */}
            <div style={{ marginBottom: '50px' }}>
                <h5 style={{ margin: '0 0 10px 0', fontSize: '16px', textDecoration: 'underline' }}>Important Instructions:</h5>
                <ul style={{ fontSize: '13px', lineHeight: '1.6', margin: '0', paddingLeft: '20px' }}>
                    <li>Students must report to the examination venue at least 15 minutes prior to the start time.</li>
                    <li>ID cards are strictly mandatory for entry.</li>
                    <li>Use of electronic gadgets (unless explicitly permitted for online tests) is strictly prohibited.</li>
                    {isOnline && <li>For online exams, students must ensure their login credentials are active before the exam.</li>}
                </ul>
            </div>

            {/* Signatures */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', paddingTop: '60px' }}>
                <div style={{ textAlign: 'center', width: '200px' }}>
                    <div style={{ borderBottom: '1px solid #000', marginBottom: '5px' }}></div>
                    <strong>Exam Controller</strong>
                    <div style={{ fontSize: '12px', color: '#555' }}>AKS University</div>
                </div>
                <div style={{ textAlign: 'center', width: '200px' }}>
                    <div style={{ borderBottom: '1px solid #000', marginBottom: '5px' }}></div>
                    <strong>Head of Department</strong>
                    <div style={{ fontSize: '12px', color: '#555' }}>{testData.department_name || 'CSE'}</div>
                </div>
            </div>

            {/* Print Styles */}
            <style>{`
                @media print {
                    @page { margin: 0; size: A4; }
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
            `}</style>
        </div>
    );
});

export default InternalTestReport;
