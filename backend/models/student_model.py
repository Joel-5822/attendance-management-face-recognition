from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class StudentModel:
    """
    Student data model for multi-descriptor enrollment
    Stores multiple face embeddings per student for higher accuracy matching
    """
    
    # In-memory database (replace with MongoDB/PostgreSQL in production)
    _students = {}
    _student_counter = 0
    
    @classmethod
    def create_student(cls, student_data, embeddings, face_image, liveness_scores):
        """
        Create a new student enrollment with multiple embeddings
        
        Args:
            student_data: Dict with name, roll_number, department, semester
            embeddings: List of embedding vectors (512-dim each for ArcFace)
            face_image: Reference face image (base64)
            liveness_scores: Liveness verification results
        
        Returns:
            student_id: Unique student identifier
        """
        try:
            cls._student_counter += 1
            student_id = f"STU_{student_data.get('department', 'UNK')}_{student_data.get('roll_number')}_{cls._student_counter}"
            
            student_record = {
                'student_id': student_id,
                'name': student_data.get('name', ''),
                'roll_number': student_data.get('roll_number', ''),
                'department': student_data.get('department', ''),
                'semester': student_data.get('semester', ''),
                'embeddings': embeddings,  # Multiple embeddings for multi-descriptor matching
                'embedding_count': len(embeddings),
                'face_image': face_image,
                'liveness_scores': liveness_scores,
                'enrolled': True,
                'enrollment_date': datetime.now().isoformat(),
                'enrollment_method': 'Face Recognition',
                'verification_status': 'Verified',
                'last_updated': datetime.now().isoformat()
            }
            
            cls._students[student_id] = student_record
            
            logger.info(f"Student {student_id} created with {len(embeddings)} embeddings")
            return student_id
        
        except Exception as e:
            logger.error(f"Error creating student: {str(e)}")
            return None
    
    @classmethod
    def get_student(cls, student_id):
        """Retrieve student record"""
        return cls._students.get(student_id)
    
    @classmethod
    def get_all_students(cls):
        """Get all enrolled students"""
        return cls._students
    
    @classmethod
    def get_all_enrollments(cls):
        """Get all enrollments formatted for face matching
        
        Returns:
            Dict: {student_id: [embeddings]}
        """
        enrollments = {}
        for student_id, student_data in cls._students.items():
            if student_data.get('enrolled'):
                enrollments[student_id] = student_data.get('embeddings', [])
        
        return enrollments
    
    @classmethod
    def update_student(cls, student_id, updates):
        """Update student record"""
        if student_id in cls._students:
            cls._students[student_id].update(updates)
            cls._students[student_id]['last_updated'] = datetime.now().isoformat()
            logger.info(f"Student {student_id} updated")
            return True
        
        return False
    
    @classmethod
    def add_embedding(cls, student_id, embedding):
        """Add a new embedding to existing student (continuous improvement)"""
        if student_id in cls._students:
            cls._students[student_id]['embeddings'].append(embedding)
            cls._students[student_id]['embedding_count'] = len(cls._students[student_id]['embeddings'])
            logger.info(f"Embedding added to {student_id}")
            return True
        
        return False
    
    @classmethod
    def delete_student(cls, student_id):
        """Delete student record"""
        if student_id in cls._students:
            del cls._students[student_id]
            logger.info(f"Student {student_id} deleted")
            return True
        
        return False
    
    @classmethod
    def get_students_by_department(cls, department):
        """Get all students in a department"""
        return {
            sid: s for sid, s in cls._students.items()
            if s.get('department') == department and s.get('enrolled')
        }
    
    @classmethod
    def get_students_by_semester(cls, semester):
        """Get all students in a semester"""
        return {
            sid: s for sid, s in cls._students.items()
            if s.get('semester') == semester and s.get('enrolled')
        }
    
    @classmethod
    def get_enrollment_statistics(cls):
        """Get enrollment statistics"""
        total = len(cls._students)
        enrolled = sum(1 for s in cls._students.values() if s.get('enrolled'))
        
        total_embeddings = sum(
            s.get('embedding_count', 0) for s in cls._students.values()
        )
        
        avg_embeddings_per_student = (
            total_embeddings / enrolled if enrolled > 0 else 0
        )
        
        return {
            'total_students': total,
            'enrolled_students': enrolled,
            'total_embeddings': total_embeddings,
            'avg_embeddings_per_student': avg_embeddings_per_student
        }
    
    @classmethod
    def export_enrollments(cls, department=None, semester=None):
        """Export enrollments as list"""
        students = cls._students
        
        if department:
            students = {k: v for k, v in students.items() if v.get('department') == department}
        
        if semester:
            students = {k: v for k, v in students.items() if v.get('semester') == semester}
        
        return list(students.values())